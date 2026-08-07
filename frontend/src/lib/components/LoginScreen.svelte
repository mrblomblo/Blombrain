<script lang="ts">
  import { login } from "../stores/auth.svelte";
  import { ShieldAlert, KeyRound, ArrowRight } from "@lucide/svelte";

  let password = $state("");
  let error = $state("");
  let loading = $state(false);

  async function handleLogin(e: SubmitEvent) {
    e.preventDefault();
    if (!password || loading) return;

    error = "";
    loading = true;

    const res = await login(password);
    if (!res.success) {
      error = res.error || "Invalid password";
      loading = false;
    }
  }
</script>

<div
  class="flex items-center justify-center min-h-screen w-screen bg-bg text-fg px-4 select-none"
>
  <div
    class="w-full max-w-md p-8 bg-bg-elevated/80 backdrop-blur-md rounded-2xl border border-line shadow-2xl space-y-6"
  >
    <div class="flex flex-col items-center text-center space-y-3">
      <div
        class="p-4 bg-accent/10 rounded-2xl text-accent border border-accent/20"
      >
        <ShieldAlert size={36} />
      </div>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Access Required</h1>
        <p class="text-sm text-fg-muted mt-1">
          This Blombrain instance is password-protected. Enter your password to
          continue.
        </p>
      </div>
    </div>

    <form onsubmit={handleLogin} class="space-y-4">
      <div class="space-y-2">
        <label
          for="password"
          class="block text-xs font-medium text-fg-muted uppercase tracking-wider"
        >
          Password
        </label>
        <div class="relative">
          <div class="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-muted">
            <KeyRound size={18} />
          </div>
          <input
            id="password"
            type="password"
            bind:value={password}
            placeholder="Enter password"
            disabled={loading}
            class="w-full bg-bg border {error
              ? 'border-danger focus:border-danger focus:ring-danger'
              : 'border-line focus:border-accent focus:ring-accent'} rounded-xl py-3 pl-11 pr-4 text-sm outline-none focus:ring-1 transition-all placeholder:text-fg-muted/60"
          />
        </div>
        {#if error}
          <p class="text-xs text-danger font-medium pt-1 animate-in fade-in-50">
            {error}
          </p>
        {/if}
      </div>

      <button
        type="submit"
        disabled={loading || !password}
        class="w-full py-3 px-4 rounded-xl bg-accent text-accent-fg font-semibold flex items-center justify-center gap-2 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md active:scale-[0.99]"
      >
        {#if loading}
          <span>Verifying...</span>
        {:else}
          <span>Unlock Instance</span>
          <ArrowRight size={18} />
        {/if}
      </button>
    </form>
  </div>
</div>
