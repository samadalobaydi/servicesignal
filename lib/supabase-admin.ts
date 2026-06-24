import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS entirely.
 *
 * ONLY used by the cron route (app/api/cron/send-reminders/route.ts),
 * which is a trusted server process authenticated via CRON_SECRET,
 * not a user session. It needs to query invoices across ALL users.
 *
 * Never import this into:
 *  - client components
 *  - the approve/dismiss routes (those use the authenticated user's
 *    session via lib/supabase-server.ts so RLS enforces ownership)
 *
 * Returns null if env vars are missing so the cron route can log a
 * clear error and exit without crashing.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.warn(
      "\x1b[33m⚠ ServiceSignal: Admin Supabase client not initialised.\x1b[0m\n" +
      `  NEXT_PUBLIC_SUPABASE_URL    → ${url ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      `  SUPABASE_SERVICE_ROLE_KEY   → ${key ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      "  The reminder cron cannot run without these."
    );
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
