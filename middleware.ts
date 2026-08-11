import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BETA_CONTINUATION_COOKIE } from "@/lib/beta-continuation";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  // Create a Supabase client that can read and refresh session cookies
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated cookies to both the request and response
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() validates the JWT server-side — never trust client-side session alone
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Protect /dashboard and /onboarding — redirect to login if not
  // authenticated. The onboarding STATUS gate is not here: it lives in the
  // dashboard layout, which can use the shared helper instead of repeating
  // the profile query on the Edge for every request.
  if (!user && (pathname.startsWith("/dashboard") || pathname.startsWith("/onboarding"))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login/signup.
  //
  // /signup carries an EXCEPTION, and it is the fix for a real bug: someone
  // already signed in as another ServiceSignal account who clicks "Create your
  // account" in a founding-beta verification email was bounced to /dashboard
  // before app/signup/page.tsx ever ran. The form never rendered, the account
  // was never created, and the old account's dashboard appeared instead —
  // which reads exactly like a broken session handoff but happens two steps
  // earlier, before any account work is attempted at all.
  //
  // Cookie PRESENCE is all this checks, and presence is not authorisation.
  // The Edge deliberately does no token validation here: app/signup/page.tsx
  // resolves the token against the database and renders BetaAccessRequired if
  // it is missing, expired, consumed or never verified. The worst a forged
  // cookie achieves is reaching that same refusal one hop later.
  const hasBetaContinuation = !!request.cookies.get(BETA_CONTINUATION_COOKIE)?.value;

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (user && pathname === "/signup" && !hasBetaContinuation) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}

export const config = {
  // Run middleware on dashboard, onboarding, login and signup routes only
  matcher: ["/dashboard/:path*", "/onboarding/:path*", "/onboarding", "/login", "/signup"],
};
