<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { fetchModels } from "../../api";
  import type { ModelInfo } from "../../types";
  import Dropdown, { type DropdownOption } from "./Dropdown.svelte";

  interface Props {
    value?: string;
    models?: ModelInfo[];
    placeholder?: string;
    disabled?: boolean;
    filterPresets?: boolean;
    onchange?: (value: string) => void;
    id?: string;
    class?: string;
    buttonClass?: string;
  }

  let {
    value = $bindable(undefined),
    models,
    placeholder = "Select model...",
    disabled = false,
    filterPresets = false,
    onchange,
    id,
    class: className = "",
    buttonClass = "",
  }: Props = $props();

  const query = createQuery(() => ({
    queryKey: ["models"],
    queryFn: fetchModels,
    enabled: !models,
  }));

  let allModels = $derived(models ?? query.data ?? []);

  let options = $derived<DropdownOption[]>(
    allModels
      .filter((m) => {
        if (filterPresets && m.isPreset) return false;
        if (m.isHidden && m.id !== value) return false;
        return true;
      })
      .map((m) => ({
        label: m.isPreset
          ? `${m.name || m.id} (Preset)`
          : `${m.name || m.id} (${m.backendName || "Model"})`,
        value: m.id,
      }))
  );
</script>

<Dropdown
  {id}
  bind:value
  {options}
  {placeholder}
  {disabled}
  {onchange}
  class={className}
  {buttonClass}
/>
