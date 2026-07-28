<script lang="ts">
  import { THEMES, THEME_LABELS, themeStore, type ThemeName } from "../theme.svelte";
  import Dropdown from "./ui/Dropdown.svelte";

  interface Props {
    value?: ThemeName;
    onchange?: (theme: ThemeName) => void;
    id?: string;
  }

  let { value, onchange, id }: Props = $props();

  const options = THEMES.map((t) => ({
    label: THEME_LABELS[t],
    value: t,
  }));

  let currentValue = $derived(value ?? themeStore.current);

  function handleChange(newTheme: string) {
    const t = newTheme as ThemeName;
    themeStore.set(t);
    onchange?.(t);
  }
</script>

<Dropdown
  {id}
  value={currentValue}
  {options}
  onchange={handleChange}
/>
