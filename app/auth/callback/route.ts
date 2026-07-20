import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * OAuth callback (v8.6.0.6).
 *
 * @supabase/ssr uses the PKCE flow: providers redirect back here with a
 * ?code= which must be exchanged for a session cookie server-side. Without
 * this route social sign-in can never complete, regardless of provider
 * configuration.
 *
 * Email/password auth does not touch this route.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";
  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  // Password recovery links land here too (v8.6.0.7) — same PKCE code
  // exchange, but failures should read as a reset-link problem and return
  // the user to /reset-password, not as a sign-in problem sent to /login.
  // The OAuth branches below are otherwise completely unchanged.
  const isRecovery = next.startsWith("/reset-password");
  const failureDestination = isRecovery ? "/reset-password" : "/login";
  const failureMessage = isRecovery
    ? "This password reset link has expired or already been used. Please request a new one."
    : null; // OAuth keeps its own specific messages below

  // Provider or Supabase rejected the sign-in — send the reason back.
  if (providerError) {
    const back = new URL(failureDestination, url.origin);
    back.searchParams.set("auth_error", failureMessage ?? providerError);
    return NextResponse.redirect(back);
  }

  if (!code) {
    const back = new URL(failureDestination, url.origin);
    back.searchParams.set("auth_error", failureMessage ?? "Sign-in was cancelled or the link has expired.");
    return NextResponse.redirect(back);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth-callback] Code exchange failed:", error.message);
    const back = new URL(failureDestination, url.origin);
    back.searchParams.set(
      "auth_error",
      failureMessage ?? "We couldn't complete that sign-in. Please try again."
    );
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
