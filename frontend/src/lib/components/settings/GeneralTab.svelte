<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import { uploadFile, serveUploadUrl } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
  import ThemeSwitcher from "../ThemeSwitcher.svelte";

  let imageUploading = $state(false);
  let formError = $state<string | null>(null);

  async function handleAvatarUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    imageUploading = true;
    formError = null;

    try {
      const upload = await uploadFile(file);
      const avatarUrl = serveUploadUrl(upload.id);
      await settingsStore.update({ userAvatar: avatarUrl });
    } catch (err) {
      formError = err instanceof Error ? err.message : "Failed to upload avatar.";
    } finally {
      imageUploading = false;
      input.value = "";
    }
  }

  async function handleRemoveAvatar() {
    await settingsStore.update({ userAvatar: null });
  }

  async function handleNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    await settingsStore.update({ userName: input.value });
  }


</script>

<div class="flex flex-col gap-6">
  {#if formError}
    <div class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
      {formError}
    </div>
  {/if}

  <!-- User Profile Section -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <h3 class="text-sm font-semibold text-fg">User Profile</h3>

    <!-- Avatar Upload -->
    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-fg-muted">Profile Avatar</span>
      <div class="flex items-center gap-3">
        {#if settingsStore.userAvatar}
          <img
            src={settingsStore.userAvatar}
            alt="User Avatar"
            class="h-10 w-10 rounded-lg object-cover border border-line bg-bg"
          />
        {:else}
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-line bg-bg font-semibold text-xs text-fg-muted"
          >
            YOU
          </div>
        {/if}

        <div class="flex items-center gap-2">
          <label
            class="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors hover:bg-bg-elevated"
          >
            <Upload size={13} />
            <span>{imageUploading ? "Uploading..." : "Upload Image"}</span>
            <input
              type="file"
              accept="image/*"
              class="hidden"
              onchange={handleAvatarUpload}
              disabled={imageUploading}
            />
          </label>

          {#if settingsStore.userAvatar}
            <button
              type="button"
              onclick={handleRemoveAvatar}
              class="h-8 rounded-md border border-line px-2.5 text-xs text-danger transition-colors hover:bg-bg cursor-pointer"
            >
              Remove
            </button>
          {/if}
        </div>
      </div>
    </div>

    <!-- User Name -->
    <div class="flex flex-col gap-1">
      <label for="user-profile-name" class="text-xs font-medium text-fg-muted">
        User Name
      </label>
      <input
        id="user-profile-name"
        type="text"
        value={settingsStore.userName}
        onchange={handleNameChange}
        placeholder="Enter your name"
        class="h-9 w-full rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors focus:border-accent focus:outline-none"
      />
    </div>
  </div>

  <!-- Appearance Section -->
  <div class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4">
    <h3 class="text-sm font-semibold text-fg">Appearance</h3>

    <div class="flex flex-col gap-1">
      <label for="user-theme-select" class="text-xs font-medium text-fg-muted">
        Theme
      </label>
      <ThemeSwitcher
        id="user-theme-select"
        value={settingsStore.theme}
        onchange={(t) => settingsStore.update({ theme: t })}
      />
    </div>
  </div>
</div>
