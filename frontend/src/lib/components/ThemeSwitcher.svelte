<script lang="ts">
  import { THEMES, THEME_LABELS, themeStore, type ThemeName } from "../theme.svelte";
</script>

<select
  class="h-8 rounded-md border border-line bg-bg-elevated px-2 text-xs text-fg outline-none"
  value={themeStore.current}
  onchange={(e) => themeStore.set(e.currentTarget.value as ThemeName)}
  aria-label="Theme"
>
  {#each THEMES as theme (theme)}
    <option value={theme}>{THEME_LABELS[theme]}</option>
  {/each}
</select>
