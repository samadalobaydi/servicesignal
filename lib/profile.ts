import type { Profile, ProfileUpdate } from "@/types";

/** Fetches (or creates) the current user's profile via /api/profile */
export async function fetchProfile(): Promise<Profile | null> {
  try {
    const res = await fetch("/api/profile");
    const data = await res.json();
    return data.success ? (data.profile as Profile) : null;
  } catch {
    return null;
  }
}

/** Updates profile fields via /api/profile — user_id always taken from session server-side */
export async function updateProfile(
  update: ProfileUpdate
): Promise<{ success: boolean; profile?: Profile; message?: string }> {
  try {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error. Please try again." };
  }
}
