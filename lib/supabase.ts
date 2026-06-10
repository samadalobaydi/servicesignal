import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client for use in server-side API routes only.
 * Never called from client components — no NEXT_PUBLIC_ prefix required.
 *
 * Env var priority (first match wins):
 *   URL  → NEXT_PUBLIC_SUPABASE_URL
 *   KEY  → SUPABASE_SERVICE_ROLE_KEY   (preferred — bypasses RLS)
 *        → NEXT_PUBLIC_SUPABASE_ANON_KEY (works with INSERT policy)
 *
 * Returns null if either var is missing so the API route can fall back
 * to console-only logging and still return success to the user.
 */
export function getServerSupabase(): SupabaseClient | null {
  // Resolve URL — only one name accepted to avoid silent mismatches
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  // Resolve key — service role preferred, anon key accepted
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  );

  if (!url || !key) {
    // Log exactly which vars are present (names only — never values)
    console.warn(
      "\x1b[33m⚠ ServiceSignal: Supabase client not initialised.\x1b[0m\n" +
      `  NEXT_PUBLIC_SUPABASE_URL        → ${url        ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      `  SUPABASE_SERVICE_ROLE_KEY       → ${process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()        ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      `  NEXT_PUBLIC_SUPABASE_ANON_KEY   → ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()   ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      "  Add the missing vars to .env.local and restart the dev server."
    );
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Legacy alias kept so any other imports don't break
export const getSupabaseClient = getServerSupabase;
