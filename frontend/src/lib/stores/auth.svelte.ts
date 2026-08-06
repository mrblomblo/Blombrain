export const authStore = $state({
  initialized: false,
  authEnabled: false,
  authenticated: false,
});

export async function checkAuth() {
  try {
    const res = await fetch("/api/auth/check", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      authStore.authEnabled = data.authEnabled;
      authStore.authenticated = data.authenticated;
    }
  } catch (e) {
    console.error("[authStore] Failed to check auth status:", e);
  } finally {
    authStore.initialized = true;
  }
}

export async function login(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        success: false,
        error: data.error?.message || "Invalid password",
      };
    }

    await checkAuth();
    return { success: true };
  } catch (e) {
    return { success: false, error: "Network error" };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } catch (e) {
    console.error("[authStore] Logout error:", e);
  } finally {
    await checkAuth();
  }
}
