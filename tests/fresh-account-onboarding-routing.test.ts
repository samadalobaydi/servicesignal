import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * A brand-new customer must enter onboarding automatically.
 *
 * ── THE REGRESSION ────────────────────────────────────────────────────────
 *
 * Account creation pushed /onboarding until 603dd3f, which redirected it to
 * /dashboard on the reasoning that the dashboard layout is "the single routing
 * authority" and would forward a new account itself:
 *
 *     required → gate redirects to /onboarding
 *     completed / exempt → stays on the dashboard
 *
 * The first line is an assumption about the LIVE DATABASE. The gate reads
 * profiles.onboarding_status; when that column is absent, unreadable, or holds
 * anything else, shouldRedirectToOnboarding fails OPEN — correctly, so nobody
 * is ever trapped — and the new customer lands on an empty Overview. Preview
 * testing found exactly that, and hash-comparing the gate across 1218d3b,
 * 603dd3f, 60480fe, 265e91c and 2ee788a showed it had never changed: the
 * regression was the destination, not the gate.
 *
 * These tests pin the destination, the navigation MECHANISM (which fixes a
 * separate bug and must survive), and the null-context bounce at /onboarding.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
/** Comments must never satisfy a contract assertion. */
const code = (f: string) =>
  read(f)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const SIGNUP = code("components/auth/SignupForm.tsx");
const PAGE = code("app/onboarding/page.tsx");
const LAYOUT = code("app/dashboard/layout.tsx");
const ONBOARDING_LIB = code("lib/onboarding.ts");
const MIDDLEWARE = code("middleware.ts");

/**
 * The account-creation success branch only.
 *
 * SCOPED DELIBERATELY. This component also handles signing an EXISTING account
 * in, whose destination is `next` — defaulting to "/dashboard" — and that is
 * correct and must not be disturbed. An unscoped search for "/dashboard" would
 * match it and make these assertions meaningless.
 */
const creationBranch = (() => {
  const start = SIGNUP.indexOf('await fetch("/api/beta/account"');
  assert.ok(start > -1, "the account-creation call must exist");
  // Ends at the OUTER catch. An earlier version stopped at the first
  // `} catch {`, which is the inner one wrapping the /api/profile warm-up —
  // several lines BEFORE the navigation, so the slice excluded the very thing
  // it was asserting on and every match failed.
  const end = SIGNUP.indexOf("setError(\"We couldn't reach ServiceSignal", start);
  assert.ok(end > start, "the outer failure handler must follow the success path");
  return SIGNUP.slice(start, end);
})();

// ── 1. Where a fresh account goes ──────────────────────────────────────────

test("successful account creation navigates directly to /onboarding", () => {
  assert.match(creationBranch, /window\.location\.replace\("\/onboarding"\)/,
    "a brand-new customer must enter onboarding automatically");

  // Immediately after the navigation, so nothing can run past it.
  const nav = creationBranch.indexOf('window.location.replace("/onboarding")');
  assert.match(creationBranch.slice(nav), /^window\.location\.replace\("\/onboarding"\);\s*return;/);
});

test("successful account creation does NOT land on the dashboard first", () => {
  // Landing on Overview before onboarding is the failure this restores.
  assert.equal(/window\.location\.(replace|assign)\("\/dashboard"\)/.test(creationBranch), false,
    "account creation must not route through the dashboard");
  assert.equal(/router\.(push|replace)\("\/dashboard"\)/.test(creationBranch), false);

  // The EXISTING-account sign-in path is untouched and still uses `next`.
  assert.match(SIGNUP, /const next = searchParams\.get\("next"\) \?\? "\/dashboard";/);
});

test("the hard-navigation fix survives the destination change", () => {
  // 60480fe replaced `router.push` + `router.refresh()` with a full document
  // navigation: the push had not committed when refresh() re-rendered the
  // still-current /signup route, whose continuation cookie the API had just
  // cleared — so a freshly-created account was shown BetaAccessRequired.
  // Only the target string was allowed to change here.
  assert.match(creationBranch, /window\.location\.replace\(/,
    "must remain a full document navigation");
  assert.equal(/router\.refresh\(\)/.test(creationBranch), false,
    "router.refresh() re-renders the abandoned /signup route — that was the bug");
  assert.equal(/router\.(push|replace)\(/.test(creationBranch), false,
    "a soft navigation reintroduces the cookie race");
  // replace, not assign: /signup's invitation is spent, so Back must not
  // return to a continuation route whose cookie no longer exists.
  assert.equal(/window\.location\.assign\(/.test(creationBranch), false);
  assert.equal(/window\.location\.href\s*=/.test(creationBranch), false);
});

// ── 2. The null-context bounce ─────────────────────────────────────────────

test("an authenticated visitor with no context is never sent through /login", () => {
  // THE LOOP: /onboarding redirected to /login?next=/onboarding, and
  // middleware redirects any signed-in visitor away from /login to /dashboard,
  // discarding `next`. The customer asked for setup and silently arrived on an
  // empty Overview — indistinguishable from onboarding not existing at all.
  assert.equal(/redirect\("\/login/.test(PAGE), false,
    "/onboarding must not redirect to /login");
  assert.equal(/\?next=\/onboarding/.test(PAGE), false);
  assert.match(PAGE, /if \(!context\) return <OnboardingAccountNotReady \/>;/);

  // The other half of the loop is still there, and still correct for /login —
  // which is why the page must not send anyone into it.
  assert.match(MIDDLEWARE, /if \(user && pathname === "\/login"\) \{\s*return NextResponse\.redirect\(new URL\("\/dashboard"/);

  // And the guarantee that makes an explanation the right answer: middleware
  // covers /onboarding, so a user always exists by the time the page runs.
  assert.match(MIDDLEWARE, /matcher: \[[^\]]*"\/onboarding"[^\]]*\]/);
  assert.match(MIDDLEWARE, /if \(!user && \(pathname\.startsWith\("\/dashboard"\) \|\| pathname\.startsWith\("\/onboarding"\)\)\)/);
});

test("the explanatory state claims no onboarding status and offers a choice", () => {
  assert.ok(existsSync(join(ROOT, "components/onboarding/OnboardingAccountNotReady.tsx")));
  const screen = code("components/onboarding/OnboardingAccountNotReady.tsx");

  // It must not assert a status — none was read.
  for (const status of ["required", "skipped", "completed", "exempt"]) {
    assert.equal(new RegExp(`"${status}"`).test(screen), false,
      `the not-ready screen must not mention the ${status} status`);
  }
  // Nor assert a cause it cannot prove: getVerifiedContext returns null for an
  // unconfirmed email AND for a failed getUser().
  assert.match(screen, /usually means/,
    "the wording must hedge — the specific cause is not established here");

  // Inert, like the other refusal screens: no form, no invoice, no skip.
  for (const active of [/<form/, /InvoiceFields/, /useInvoiceForm/, /Skip for now/, /"use client"/]) {
    assert.equal(active.test(screen), false, `the not-ready screen must not ${active}`);
  }

  // A link the customer chooses, not a redirect they cannot see.
  assert.match(screen, /<Link href="\/dashboard"/);
});

// ── 3. Nothing else about the gate moved ───────────────────────────────────

test("the onboarding gate itself is unchanged", () => {
  // The regression was never here, and this pass must not make it so.
  assert.match(ONBOARDING_LIB,
    /export function shouldRedirectToOnboarding[\s\S]{0,200}if \(context\.kind !== "ready"\) return false;/);
  assert.match(ONBOARDING_LIB, /return context\.status === "required";/);
  assert.match(LAYOUT, /if \(context && shouldRedirectToOnboarding\(context\)\) \{\s*redirect\("\/onboarding"\);/);
  // Still fails OPEN for a null context — the dashboard must never trap anyone.
  assert.match(LAYOUT, /const context = await getVerifiedContext\(\);/);

  // The confirmation check that produces a null context is untouched.
  assert.match(ONBOARDING_LIB, /if \(!user\.email_confirmed_at\) return null;/);
});

test("required still renders the flow, and completed/exempt still do not", () => {
  // onboardingView is the only thing deciding which screen /onboarding shows,
  // and this pass added a branch BEFORE it without altering it.
  assert.match(ONBOARDING_LIB,
    /export function onboardingView[\s\S]{0,300}if \(context\.kind !== "ready"\) return "unavailable";[\s\S]{0,200}return context\.status === "required" \|\| context\.status === "skipped" \? "flow" : "all_set";/);

  // The page's dispatch, in order: not-ready → unavailable → all_set → flow.
  //
  // Anchored on the GUARD, not on the component name. A mutant that hoisted
  // `onboardingView(context!)` above the null check left the JSX in the same
  // source position and slipped through an ordering test that compared
  // component positions — while making the page call onboardingView with a
  // possibly-null context, silenced by a non-null assertion.
  const guard = PAGE.indexOf("if (!context)");
  const view = PAGE.indexOf("const view = onboardingView(");
  const unavailable = PAGE.indexOf('view === "unavailable"');
  const allSet = PAGE.indexOf('view === "all_set"');
  const flow = PAGE.indexOf("<OnboardingFlow");
  assert.ok(guard > -1 && view > guard,
    "the null context must be handled BEFORE onboardingView is called");
  assert.ok(unavailable > view && allSet > unavailable && flow > allSet,
    "the new branch must sit before the status branches, not replace them");
  assert.equal(/onboardingView\(context!\)|context as /.test(PAGE), false,
    "a non-null assertion would hide exactly this mistake from the compiler");

  assert.match(PAGE, /if \(view === "all_set"\) return <OnboardingAllSet status=\{statusOf\(context\)\} \/>;/);
  assert.match(PAGE, /needsBusinessName=\{needsBusinessName\}/);

  // And the flow still opens on the invoice step when the name is known.
  assert.match(code("components/onboarding/OnboardingFlow.tsx"),
    /useState<1 \| 2 \| 3 \| 4>\(needsBusinessName \? 1 : 2\)/);
  assert.match(code("components/onboarding/OnboardingAllSet.tsx"),
    /const finished = status === "completed";/);
});

test("this pass did not touch the due-date lifecycle it sits beside", () => {
  const flow = code("components/onboarding/OnboardingFlow.tsx");
  // Case B still records before it shows, and the CTA is still navigation only.
  assert.match(flow, /if \(result\.ok\) \{[\s\S]{0,300}?setStep\(4\)/);
  assert.match(flow, /const goToAddedInvoice = useCallback\(\(\) => \{/);
  // The server evidence check is still absolute.
  assert.match(code("app/api/onboarding/status/route.ts"),
    /if \(eligibility\.schedule\) \{[\s\S]{0,600}status: 422/);
  // And no due-date restriction came back.
  assert.equal(/requireReminderEligibility/.test(code("lib/invoice-form.ts")), false);
});
