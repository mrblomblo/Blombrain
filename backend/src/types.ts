/** Shape of each entry in config/backends.json. */
export interface BackendConfig {
  id: string;
  name: string;
  /** Base URL of an OpenAI-compatible endpoint, e.g. http://127.0.0.1:8080 */
  baseUrl: string;
  /** Prefix applied to model ids when aggregating across backends, e.g. "local" -> "local:llama-3". Defaults to `id`. */
  prefix?: string;
  /** Literal API key. Prefer apiKeyEnv for anything that isn't a fully-local endpoint. */
  apiKey?: string;
  /** Name of an environment variable to read the API key from at startup. Takes precedence over apiKey. */
  apiKeyEnv?: string;
}

/** A backend after config has been loaded and env-based keys resolved. */
export interface ResolvedBackend {
  id: string;
  name: string;
  baseUrl: string;
  prefix: string;
  apiKey?: string;
}

/** Public shape sent to the frontend -- never includes the API key. */
export interface BackendInfo {
  id: string;
  name: string;
  prefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  status: "online" | "offline" | "unknown";
}

export interface ModelInfo {
  id: string;
  rawId: string;
  backendId: string;
  backendName: string;
}
