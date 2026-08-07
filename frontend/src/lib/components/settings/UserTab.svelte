<script lang="ts">
  import { Upload } from "@lucide/svelte";
  import { uploadFile, serveUploadUrl } from "../../api";
  import { settingsStore } from "../../stores/settings.svelte";
  import { checkAuth } from "../../stores/auth.svelte";
  import ThemeSwitcher from "../ThemeSwitcher.svelte";
  import Button from "../ui/Button.svelte";
  import { confirmStore } from "../../stores/confirmStore.svelte";

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
      formError =
        err instanceof Error ? err.message : "Failed to upload avatar.";
    } finally {
      imageUploading = false;
      input.value = "";
    }
  }

  async function handleRemoveAvatar() {
    const confirmed = await confirmStore.confirm({
      title: "Remove Avatar",
      message: "Are you sure you want to remove your profile avatar?",
      confirmText: "Remove",
      confirmStyle: "danger",
      cancelText: "Cancel",
      cancelStyle: "ghost",
      cancelOutline: true,
    });
    if (confirmed) {
      await settingsStore.update({ userAvatar: null });
    }
  }

  let newPassword = $state("");
  let confirmPassword = $state("");
  let passwordMsg = $state("");
  let passwordError = $state(false);
  let passwordUpdating = $state(false);

  async function handlePasswordUpdate() {
    passwordMsg = "";
    passwordError = false;

    if (newPassword !== confirmPassword) {
      passwordError = true;
      passwordMsg = "Passwords do not match";
      return;
    }

    passwordUpdating = true;
    try {
      await settingsStore.update({ password: newPassword });
      await checkAuth();
      passwordError = false;
      passwordMsg =
        newPassword.trim() === ""
          ? "Password removed. Auth disabled."
          : "Password updated successfully.";
      newPassword = "";
      confirmPassword = "";
    } catch (e: any) {
      passwordError = true;
      passwordMsg = e.message || "Failed to update password";
    } finally {
      passwordUpdating = false;
    }
  }

  async function handleNameChange(e: Event) {
    const input = e.target as HTMLInputElement;
    await settingsStore.update({ userName: input.value });
  }
</script>

<div class="flex flex-col gap-6">
  {#if formError}
    <div
      class="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      {formError}
    </div>
  {/if}

  <!-- User Profile Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
    <div class="border-b border-line pb-3">
      <h3 class="text-sm font-semibold text-fg">User Profile</h3>
      <p class="text-xs text-fg-subtle mt-0.5">
        Manage your profile and preferences.
      </p>
    </div>

    <!-- Avatar Upload -->
    <div class="flex flex-col gap-2">
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
            <Button
              variant="danger"
              outline
              size="sm"
              onclick={handleRemoveAvatar}
            >
              Remove
            </Button>
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
        class="h-9 w-full rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors focus:border-accent"
      />
    </div>

    <div class="h-px bg-line/60"></div>
    <!-- Instance Password Section -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-0.5">
        <span class="text-xs font-semibold text-fg">Instance Password</span>
        <span class="text-[11px] text-fg-muted"
          >Set a password to require authentication when opening Blombrain.
          Leave blank to disable auth.</span
        >
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <label for="new-password" class="text-xs font-medium text-fg-muted"
            >New Password</label
          >
          <input
            id="new-password"
            type="password"
            bind:value={newPassword}
            placeholder="New password (blank to disable)"
            class="h-9 w-full rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors focus:border-accent"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label
            for="confirm-password"
            class="text-xs font-medium text-fg-muted">Confirm Password</label
          >
          <input
            id="confirm-password"
            type="password"
            bind:value={confirmPassword}
            placeholder="Confirm password"
            class="h-9 w-full rounded-md border border-line bg-bg px-3 text-xs text-fg transition-colors focus:border-accent"
          />
        </div>
      </div>

      <div
        class="flex flex-col sm:flex-row sm:items-center justify-between gap-2"
      >
        <div>
          {#if passwordMsg}
            <p class="text-xs {passwordError ? 'text-danger' : 'text-success'}">
              {passwordMsg}
            </p>
          {/if}
        </div>

        <Button
          variant={newPassword.length > 0 && confirmPassword.length > 0
            ? "accent"
            : "default"}
          size="sm"
          onclick={handlePasswordUpdate}
          disabled={passwordUpdating}
        >
          {passwordUpdating ? "Saving..." : "Update Password"}
        </Button>
      </div>
    </div>
  </div>

  <!-- Appearance Section -->
  <div
    class="rounded-lg border border-line bg-bg-elevated p-4 flex flex-col gap-4"
  >
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
