<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    timestamp?: number;
  }
  const { timestamp }: Props = $props();

  let formattedTime = $state("");

  function update() {
    if (!timestamp) {
      formattedTime = "";
      return;
    }

    const diffMs = Date.now() - timestamp;
    const mins = Math.floor(diffMs / 60_000);

    if (mins < 1) {
      formattedTime = "just now";
      return;
    }

    if (mins < 60) {
      formattedTime = `${mins}m ago`;
      return;
    }

    const hrs = Math.floor(mins / 60);
    if (hrs < 24) {
      formattedTime = `${hrs}h ago`;
      return;
    }

    const d = new Date(timestamp);
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    formattedTime = `${d.getMonth() + 1}/${d.getDate()} ${hours}:${minutes}`;
  }

  onMount(() => {
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  });
</script>

{#if formattedTime}
  <span class="text-[11px] font-mono text-fg-subtle opacity-75">
    {formattedTime}
  </span>
{/if}
