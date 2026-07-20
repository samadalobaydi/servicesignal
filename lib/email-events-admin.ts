import "server-only"; // build FAILS if this file is ever imported into client-bundled code
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — SOLELY for email_events operations.
 *
 * Deliberately named and scoped apart from lib/supabase-admin.ts, which
 * already exists and is dedicated to the reminder cron system (queries
 * invoices across all users). Do not merge these two — they serve
 * different, independently-approved purposes, and keeping them separate
 * files is what makes each one's blast radius easy to reason about.
 *
 * ONLY import this from lib/email-events.ts. Never from a client
 * component, never from anything driven by unauthenticated or
 * client-supplied input without the caller having independently
 * verified identity first via the normal getSupabaseServer()/getUser()
 * pattern used everywhere else in this codebase.
 *
 * service_role bypasses Row Level Security entirely and has broad
 * database access by design — that narrowness above is enforced by
 * this module boundary, the server-only import guard, and code review,
 * not by anything Postgres itself restricts about the role.
 *
 * Returns null if env vars are missing so callers can fail gracefully.
 */
export function getEmailEventsAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !key) {
    console.warn(
      "\x1b[33m⚠ ServiceSignal: email-events admin client not initialised.\x1b[0m\n" +
      `  NEXT_PUBLIC_SUPABASE_URL    → ${url ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      `  SUPABASE_SERVICE_ROLE_KEY   → ${key ? "\x1b[32m✓ found\x1b[0m" : "\x1b[31m✗ missing\x1b[0m"}\n` +
      "  Welcome emails cannot be sent until this is configured."
    );
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
