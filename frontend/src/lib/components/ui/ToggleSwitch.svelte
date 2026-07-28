<script lang="ts">
  interface Props {
    checked?: boolean;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
    id?: string;
    label?: string;
    class?: string;
  }

  let {
    checked = $bindable(false),
    disabled = false,
    onchange,
    id,
    label = "Toggle switch",
    class: className = "",
  }: Props = $props();

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<button
  {id}
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={toggle}
  class="relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed {checked
    ? 'bg-accent'
    : 'bg-line-strong'} {className}"
>
  <span
    aria-hidden="true"
    class="pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition-transform duration-200 ease-in-out {checked
      ? 'translate-x-3.5'
      : 'translate-x-0.5'}"
  ></span>
</button>
