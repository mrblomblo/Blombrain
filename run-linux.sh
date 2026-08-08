#!/usr/bin/env bash

set -uo pipefail
set -m   # enable job control so each background job gets its own process group

# ---------------------------------------------------------------------------
# Paths (resolved relative to this script, so it works from any cwd)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
MODE="prod"              # prod | dev
EXPOSE_HOST=false        # --host
REBUILD=false            # --rebuild
BACKEND_PORT=4300
FRONTEND_PORT=5173
SKIP_INSTALL=false
RAW_LOGS=false           # --raw-logs: don't reformat backend JSON logs
VERBOSE=false
USE_COLOR=true
FORCE=false              # --force: run anyway on a non-24 Node version
NVM_SWITCH=false         # --nvm: try to switch to Node 24 via nvm first
REQUIRED_NODE_MAJOR=24

LOG_FMT_FILE=""          # populated at startup, cleaned up on exit
BACKEND_JOB=""
FRONTEND_JOB=""

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
print_help() {
  cat <<EOF
Usage: ./run-linux.sh [options]

Runs Blombrain (frontend + backend). With no options, starts the
existing production-ish backend build as-is (API + built frontend on
one port, :$BACKEND_PORT by default) WITHOUT rebuilding anything --
pass --rebuild if you've changed source and need a fresh build.

Options:
  --dev                    Run in development mode: starts the Fastify
                           backend (tsx watch) and the Vite dev server
                           as two hot-reloading processes at once,
                           instead of running/building for production.

  --rebuild                Build frontend and backend before starting.
                           Production mode only (--dev always runs from
                           source, no build needed). Without this flag,
                           production mode reuses whatever is already
                           in frontend/dist and backend/dist and will
                           refuse to start if either is missing.

  --host                   Expose the server(s) to your LAN, not just
                           localhost. In --dev mode this passes --host
                           to the Vite dev server. In either mode it
                           also sets HOST=0.0.0.0 for the backend.
                           Note: the backend already listens on all
                           local interfaces by default, so this mainly
                           matters for the frontend dev server.

  --port <port>            Backend port (default: $BACKEND_PORT).
                           Exported to the backend as \$PORT.

  --frontend-port <port>   Frontend dev server port, --dev mode only
                           (default: $FRONTEND_PORT). Passed to Vite.

  --skip-install           Skip "npm install" in frontend/ and backend/
                           before running/building.

  --nvm                    Try to switch to Node ${REQUIRED_NODE_MAJOR} automatically before
                           doing anything else, using nvm. Tries, in
                           order: sourcing ~/.nvm/nvm.sh + "nvm use
                           ${REQUIRED_NODE_MAJOR}", then falling back to prepending
                           ~/.nvm/versions/node/v${REQUIRED_NODE_MAJOR}.*/bin to \$PATH directly.
                           Set \$NVM_DIR to use a different nvm location.

  --force                  Run even if the active Node version isn't
                           ${REQUIRED_NODE_MAJOR}.x. Without this, a wrong Node version is a
                           hard error (use --nvm to fix it automatically,
                           or --force to proceed at your own risk).

  --raw-logs               Don't reformat the backend's JSON log lines
                           into human-readable text -- print them raw,
                           exactly as emitted.

  --no-color               Disable colored output.

  -v, --verbose            Print extra diagnostic info (commands run,
                           detected Node version, resolved paths), and
                           also show per-request "incoming request"
                           lines from the backend (normally only the
                           merged "completed" line is shown).

  -h, --help               Show this help message and exit.

Examples:
  ./run-linux.sh                        # run existing build, localhost only
  ./run-linux.sh --rebuild              # build fresh, then run
  ./run-linux.sh --host                 # run existing build, exposed on LAN
  ./run-linux.sh --dev                  # dev mode, two hot-reload servers
  ./run-linux.sh --dev --host           # dev mode, exposed on LAN
  ./run-linux.sh --rebuild --port 8080
  ./run-linux.sh --dev --frontend-port 5174
  ./run-linux.sh --nvm                  # auto-switch to Node ${REQUIRED_NODE_MAJOR} via nvm, then run
  ./run-linux.sh --force                # run anyway on whatever Node version is active
EOF
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_help
      exit 0
      ;;
    --dev)
      MODE="dev"
      shift
      ;;
    --rebuild)
      REBUILD=true
      shift
      ;;
    --host)
      EXPOSE_HOST=true
      shift
      ;;
    --port)
      BACKEND_PORT="${2:?--port requires a value}"
      shift 2
      ;;
    --port=*)
      BACKEND_PORT="${1#*=}"
      shift
      ;;
    --frontend-port)
      FRONTEND_PORT="${2:?--frontend-port requires a value}"
      shift 2
      ;;
    --frontend-port=*)
      FRONTEND_PORT="${1#*=}"
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=true
      shift
      ;;
    --nvm)
      NVM_SWITCH=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --raw-logs)
      RAW_LOGS=true
      shift
      ;;
    --no-color)
      USE_COLOR=false
      shift
      ;;
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run './run-linux.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Colors / logging helpers (for this script's own output, not the app's)
# ---------------------------------------------------------------------------
if [[ -t 1 && "$USE_COLOR" == true ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'
else
  C_RESET=""; C_BOLD=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_CYAN=""
fi

log()     { echo "${C_CYAN}[run-linux]${C_RESET} $*"; }
ok()      { echo "${C_GREEN}[run-linux]${C_RESET} $*"; }
warn()    { echo "${C_YELLOW}[run-linux]${C_RESET} $*" >&2; }
err()     { echo "${C_RED}[run-linux]${C_RESET} $*" >&2; }
verbose() { [[ "$VERBOSE" == true ]] && echo "${C_CYAN}[run-linux:v]${C_RESET} $*"; }

# ---------------------------------------------------------------------------
# Log formatter: turns the backend's pino/JSON log lines into readable
# text. Anything that fails to parse as JSON, or doesn't look like a
# pino record, is printed through completely unchanged.
# ---------------------------------------------------------------------------
write_log_formatter() {
  LOG_FMT_FILE="$(mktemp --suffix=.cjs)"
  cat > "$LOG_FMT_FILE" <<'NODE_EOF'
const readline = require('readline');

const VERBOSE = process.env.RUN_LINUX_VERBOSE === 'true';
const USE_COLOR = process.env.RUN_LINUX_COLOR === 'true';

const c = USE_COLOR
  ? {
      reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
      red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
      blue: '\x1b[34m', cyan: '\x1b[36m',
    }
  : new Proxy({}, { get: () => '' });

const LEVELS = {
  10: ['TRACE', c.dim],
  20: ['DEBUG', c.cyan],
  30: ['INFO ', c.green],
  40: ['WARN ', c.yellow],
  50: ['ERROR', c.red],
  60: ['FATAL', c.bold + c.red],
};

// Correlates "incoming request" / "request completed" pairs by reqId so
// we can print one merged, readable line per request instead of two.
const pending = new Map();

function timeStr(ms) {
  try {
    return new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
  } catch {
    return '';
  }
}

function statusColor(code) {
  if (code >= 500) return c.red;
  if (code >= 400) return c.yellow;
  if (code >= 300) return c.cyan;
  return c.green;
}

function passthrough(line) {
  process.stdout.write(line + '\n');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    passthrough(line);
    return;
  }

  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    passthrough(line); // not JSON at all -- pass it through as-is
    return;
  }

  // Doesn't look like a pino log record -- pass the raw string through
  // rather than guessing at a format.
  if (
    entry === null ||
    typeof entry !== 'object' ||
    Array.isArray(entry) ||
    typeof entry.level !== 'number' ||
    typeof entry.time === 'undefined'
  ) {
    passthrough(line);
    return;
  }

  const [levelName, levelColor] = LEVELS[entry.level] || [String(entry.level), ''];
  const prefix = `${c.dim}${timeStr(entry.time)}${c.reset} ${levelColor}${levelName}${c.reset}`;

  try {
    // Incoming request (fastify's default request logger)
    if (entry.msg === 'incoming request' && entry.req && typeof entry.req === 'object') {
      const { method, url } = entry.req;
      if (entry.reqId) pending.set(entry.reqId, { method, url });
      if (VERBOSE) {
        passthrough(`${prefix} ${c.blue}\u2192${c.reset} ${method} ${url}`);
      }
      return;
    }

    // Completed request -- merge with the stored "incoming" info if we have it
    if (entry.msg === 'request completed' && entry.res && typeof entry.res === 'object') {
      const stored = entry.reqId ? pending.get(entry.reqId) : undefined;
      if (entry.reqId) pending.delete(entry.reqId);

      const status = entry.res.statusCode;
      const timing =
        typeof entry.responseTime === 'number' ? `${entry.responseTime.toFixed(1)}ms` : '';
      const label = stored ? `${stored.method} ${stored.url}` : '(request)';

      passthrough(
        `${prefix} ${statusColor(status)}${status}${c.reset} ${label}${timing ? ' ' + c.dim + timing + c.reset : ''}`
      );
      return;
    }

    // Generic structured message
    if (typeof entry.msg === 'string' && entry.msg.length > 0) {
      passthrough(`${prefix} ${entry.msg}`);
      return;
    }

    // Recognizable pino record, but no msg field we know how to render --
    // fall back to the raw line rather than inventing something.
    passthrough(line);
  } catch {
    // Any unexpected shape while formatting -- never crash the pipe,
    // just show the user the original line.
    passthrough(line);
  }
});
NODE_EOF
}

cleanup_log_formatter() {
  [[ -n "$LOG_FMT_FILE" && -f "$LOG_FMT_FILE" ]] && rm -f "$LOG_FMT_FILE"
}

# Pipes stdin through the Node formatter, unless --raw-logs was given.
format_logs() {
  if [[ "$RAW_LOGS" == true ]]; then
    cat
  else
    RUN_LINUX_VERBOSE="$VERBOSE" RUN_LINUX_COLOR="$USE_COLOR" node "$LOG_FMT_FILE"
  fi
}

# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

# Tries to get Node $REQUIRED_NODE_MAJOR onto $PATH for the rest of this
# script (and everything it spawns), using nvm. Two strategies, in order:
#   1. Source nvm.sh (the normal way) and run "nvm use $REQUIRED_NODE_MAJOR".
#   2. Fall back to prepending the matching version's bin/ dir straight
#      onto $PATH, in case nvm.sh isn't sourced/available in this shell.
# Never fatal on its own -- if it can't find a match, it just warns and
# leaves the version check below to fail (or pass, or be --force'd).
switch_node_version() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"

  if [[ -s "$nvm_dir/nvm.sh" ]]; then
    verbose "Sourcing $nvm_dir/nvm.sh and running 'nvm use $REQUIRED_NODE_MAJOR'..."
    # shellcheck disable=SC1090,SC1091
    source "$nvm_dir/nvm.sh" --no-use
    if command -v nvm &>/dev/null && nvm use "$REQUIRED_NODE_MAJOR" &>/dev/null; then
      ok "Switched to $(node -v) via nvm."
      return 0
    fi
    verbose "'nvm use $REQUIRED_NODE_MAJOR' didn't work (not installed via nvm?), trying PATH fallback..."
  else
    verbose "No $nvm_dir/nvm.sh found, trying PATH fallback..."
  fi

  local versions_dir="$nvm_dir/versions/node"
  if [[ -d "$versions_dir" ]]; then
    local match
    match="$(find "$versions_dir" -maxdepth 1 -type d -name "v${REQUIRED_NODE_MAJOR}.*" 2>/dev/null | sort -V | tail -n1)"
    if [[ -n "$match" && -x "$match/bin/node" ]]; then
      PATH="$match/bin:$PATH"
      export PATH
      ok "Switched to $(node -v) by adding $match/bin to \$PATH."
      return 0
    fi
  fi

  warn "Could not find a Node ${REQUIRED_NODE_MAJOR}.x install under $nvm_dir to switch to."
  return 1
}

check_prereqs() {
  if [[ ! -d "$FRONTEND_DIR" || ! -d "$BACKEND_DIR" ]]; then
    err "Expected 'frontend/' and 'backend/' next to this script (looked in: $SCRIPT_DIR)."
    exit 1
  fi

  if [[ "$NVM_SWITCH" == true ]]; then
    switch_node_version || true
  fi

  if ! command -v node &>/dev/null; then
    err "Node.js was not found on PATH. Blombrain requires Node.js ${REQUIRED_NODE_MAJOR}."
    [[ "$NVM_SWITCH" != true ]] && err "Try passing --nvm to switch automatically via nvm."
    exit 1
  fi

  if ! command -v npm &>/dev/null; then
    err "npm was not found on PATH."
    exit 1
  fi

  local node_version node_major
  node_version="$(node -v)"                      # e.g. v24.16.0
  node_major="${node_version#v}"
  node_major="${node_major%%.*}"
  verbose "Detected Node $node_version"

  if [[ "$node_major" != "$REQUIRED_NODE_MAJOR" ]]; then
    if [[ "$FORCE" == true ]]; then
      warn "Blombrain requires Node.js ${REQUIRED_NODE_MAJOR}.x, but found ${node_version} -- continuing anyway (--force)."
    else
      err "Blombrain requires Node.js ${REQUIRED_NODE_MAJOR}.x, but found ${node_version}."
      err "Switch versions yourself (e.g. 'nvm use ${REQUIRED_NODE_MAJOR}') and re-run, pass --nvm to have"
      err "this script switch automatically, or pass --force to run anyway at your own risk."
      exit 1
    fi
  fi
}

# ---------------------------------------------------------------------------
# Dev mode: run backend + frontend dev servers concurrently
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Shutdown / signal handling
# ---------------------------------------------------------------------------
CLEANUP_DONE=false
STTY_SAVE=""

save_terminal_state() {
  if [[ -t 0 ]]; then
    STTY_SAVE="$(stty -g 2>/dev/null)" || STTY_SAVE=""
  fi
}

restore_terminal() {
  [[ -t 0 ]] || return 0
  # Non-canonical, timed read (time=1 => 0.1s) so pending bytes can be
  # read even without a newline.
  stty -icanon min 0 time 1 2>/dev/null || return 0
  sleep 0.1   # give any in-flight replies a moment to arrive
  local chunk i=0 total=0
  while (( i++ < 40 )) && IFS= read -r -n 256 -t 1 chunk; do
    total=$(( total + ${#chunk} ))
  done
  if (( total > 0 )); then
    verbose "Discarded $total byte(s) of stale terminal replies"
  fi
  if [[ -n "$STTY_SAVE" ]]; then
    stty "$STTY_SAVE" 2>/dev/null || stty sane 2>/dev/null || true
  else
    stty sane 2>/dev/null || true
  fi
  return 0
}

cleanup() {
  [[ "$CLEANUP_DONE" == true ]] && return
  CLEANUP_DONE=true

  local jobs=()
  [[ -n "$BACKEND_JOB" ]] && jobs+=("$BACKEND_JOB")
  [[ -n "$FRONTEND_JOB" ]] && jobs+=("$FRONTEND_JOB")

  if (( ${#jobs[@]} > 0 )); then
    local j
    for j in "${jobs[@]}"; do
      kill -TERM -- "-$j" 2>/dev/null    # negative pid => whole process group
    done
    # Grace period: wait up to ~2s for a clean exit...
    local deadline=$(( SECONDS + 2 )) alive=1
    while (( alive )) && (( SECONDS < deadline )); do
      alive=0
      for j in "${jobs[@]}"; do
        if kill -0 -- "-$j" 2>/dev/null; then alive=1; break; fi
      done
      (( alive )) && sleep 0.1
    done
    # ...then hard-kill anything still alive.
    for j in "${jobs[@]}"; do
      kill -KILL -- "-$j" 2>/dev/null
    done
    wait 2>/dev/null || true
  fi

  restore_terminal
  cleanup_log_formatter
}

on_signal() {
  local sig="$1" num="$2"
  trap '' INT TERM HUP QUIT TSTP   # don't let a second signal interrupt cleanup
  log "Caught SIG${sig}, shutting down..."
  cleanup
  trap - EXIT
  exit $(( 128 + num ))
}

run_dev() {
  log "Starting in ${C_BOLD}dev${C_RESET} mode (backend + frontend, hot reload)..."

  local vite_args=(--port "$FRONTEND_PORT")
  [[ "$EXPOSE_HOST" == true ]] && vite_args+=(--host)

  verbose "Backend:  cd $BACKEND_DIR && npm run dev  (PORT=$BACKEND_PORT)"
  verbose "Frontend: cd $FRONTEND_DIR && npm run dev -- ${vite_args[*]}"

  (
    cd "$BACKEND_DIR" || exit 1
    [[ "$SKIP_INSTALL" == true ]] || npm install
    export PORT="$BACKEND_PORT"
    [[ "$EXPOSE_HOST" == true ]] && export HOST="0.0.0.0"
    npm run dev 2>&1 | format_logs
  ) &
  BACKEND_JOB=$!

  (
    cd "$FRONTEND_DIR" || exit 1
    [[ "$SKIP_INSTALL" == true ]] || npm install
    npm run dev -- "${vite_args[@]}" 2>&1 | format_logs
  ) &
  FRONTEND_JOB=$!

  # If either process dies on its own, bring the other down too.
  local rc=0
  wait -n "$BACKEND_JOB" "$FRONTEND_JOB" || rc=$?
  if kill -0 "$BACKEND_JOB" 2>/dev/null; then
    verbose "Frontend exited first; stopping backend..."
  else
    verbose "Backend exited first; stopping frontend..."
  fi
  cleanup
  exit "$rc"
}

# ---------------------------------------------------------------------------
# Production-ish mode: run the existing build; --rebuild to build first
# ---------------------------------------------------------------------------
run_prod() {
  if [[ "$REBUILD" == true ]]; then
    log "Rebuilding (--rebuild)..."

    log "Building frontend..."
    (
      cd "$FRONTEND_DIR" || exit 1
      [[ "$SKIP_INSTALL" == true ]] || npm install
      npm run build
    ) || { err "Frontend build failed."; exit 1; }

    log "Building backend..."
    (
      cd "$BACKEND_DIR" || exit 1
      [[ "$SKIP_INSTALL" == true ]] || npm install
      npm run build
    ) || { err "Backend build failed."; exit 1; }
  else
    if [[ ! -d "$FRONTEND_DIR/dist" || ! -d "$BACKEND_DIR/dist" ]]; then
      err "No existing build found (frontend/dist and/or backend/dist is missing)."
      err "Run with --rebuild once to build them: ./run-linux.sh --rebuild"
      exit 1
    fi
    log "Running existing build as-is (pass --rebuild to build fresh first)."
  fi

  if [[ "$EXPOSE_HOST" == true ]]; then
    log "Note: the backend already listens on all local network interfaces by"
    log "default (see the 'Server listening at ...' lines on startup); --host"
    log "is applied here for consistency but shouldn't be required in prod mode."
  fi

  log "Starting backend (serves API + built frontend on :$BACKEND_PORT)..."

  (
    cd "$BACKEND_DIR" || exit 1
    export PORT="$BACKEND_PORT"
    [[ "$EXPOSE_HOST" == true ]] && export HOST="0.0.0.0"
    npm start 2>&1 | format_logs
  ) &
  BACKEND_JOB=$!

  local rc=0
  wait "$BACKEND_JOB" || rc=$?
  cleanup
  exit "$rc"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
check_prereqs
write_log_formatter
save_terminal_state

for sig in INT TERM HUP QUIT TSTP; do
  trap "on_signal $sig $(kill -l "$sig")" "$sig"
done
trap cleanup EXIT

if [[ "$MODE" == "dev" ]]; then
  run_dev
else
  run_prod
fi
