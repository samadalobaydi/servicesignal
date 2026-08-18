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

/**
 * The genuinely-new-account path: everything AFTER the reconciled branch.
 *
 * SCOPED DELIBERATELY. A reconciled account — an Auth user that already
 * existed, which /api/beta/account reports with `reconciled: true` — goes to
 * /dashboard, so "/dashboard" legitimately appears in this handler now. An
 * unscoped search would match that and prove nothing.
 */
const newAccountPath = (() => {
  const guard = creationBranch.indexOf("if (payload?.reconciled) {");
  assert.ok(guard > -1, "the new/reconciled distinction must exist");
  const after = creationBranch.indexOf("}", creationBranch.indexOf('replace("/dashboard")', guard));
  assert.ok(after > guard);
  return creationBranch.slice(after);
})();

test("successful account creation does NOT land on the dashboard first", () => {
  // Landing on Overview before onboarding is the failure this restores.
  assert.equal(/window\.location\.(replace|assign)\("\/dashboard"\)/.test(newAccountPath), false,
    "a genuinely new account must not route through the dashboard");
  assert.equal(/router\.(push|replace)\("\/dashboard"\)/.test(newAccountPath), false);
  assert.match(newAccountPath, /window\.location\.replace\("\/onboarding"\)/);

  // The EXISTING-account sign-in path is untouched and still uses `next`.
  assert.match(SIGNUP, /const next = searchParams\.get\("next"\) \?\? "\/dashboard";/);
});

test("a reconciled account is NOT sent into first-run onboarding", () => {
  // THE OBSERVED FAILURE. /api/beta/account answers `reconciled: true` when
  // createUser reported the address is already registered — an EXISTING Auth
  // user. Routing that account to /onboarding showed an established customer
  // "Your account is ready — there's nothing to set up", which is the correct
  // reading of a real `exempt` status at the wrong destination.
  const reconciled = creationBranch.slice(
    creationBranch.indexOf("if (payload?.reconciled) {"),
    creationBranch.indexOf('window.location.replace("/onboarding")')
  );
  assert.match(reconciled, /window\.location\.replace\("\/dashboard"\);\s*return;/);
  assert.equal(/replace\("\/onboarding"\)/.test(reconciled), false,
    "an existing account must not be sent to first-run setup");

  // The guard comes BEFORE the onboarding navigation, so it cannot fall past.
  const guardIdx = creationBranch.indexOf("if (payload?.reconciled)");
  const onboardingIdx = creationBranch.indexOf('window.location.replace("/onboarding")');
  assert.ok(guardIdx > -1 && onboardingIdx > guardIdx);

  // Still a hard navigation, still replace, on BOTH paths.
  assert.equal(/router\.(push|replace)\(/.test(creationBranch), false);
  assert.equal(/window\.location\.assign\(/.test(creationBranch), false);
});

test("nothing writes onboarding_status during account creation", () => {
  // NOT the fix. Stamping `required` from the account route would need a
  // fourth writer, would have to run for reconciled users too unless guarded,
  // and a mistake there turns a long-standing `completed` or `exempt` customer
  // back into a first-run one. The state is already established three
  // independent ways — see the required-state test below.
  const route = code("app/api/beta/account/route.ts");
  assert.equal(/onboarding_status/.test(route), false,
    "the account-creation route must not write onboarding status");
  assert.equal(/from\("profiles"\)/.test(route), false,
    "profiles is created by exactly one path, and it is not this one");

  // And the client writes none either — it only asks the canonical path to run.
  assert.equal(/onboarding_status/.test(SIGNUP), false);
  assert.match(SIGNUP, /await fetch\("\/api\/profile", \{ cache: "no-store" \}\)/);
});

test("a genuinely new account reaches `required` three independent ways", () => {
  // 1. THE COLUMN DEFAULT. Migration 005 sets it after backfilling, so it
  //    applies only to rows created from then on.
  const migration = readFileSync(join(ROOT, "supabase/sql/005_onboarding_status.sql"), "utf8");
  assert.match(migration, /alter column onboarding_status set default 'required'/);
  //    …and `exempt` is written by exactly ONE statement in the whole system:
  //    the backfill of rows that already existed when 005 ran. That is why a
  //    profile reading `exempt` cannot have been created after the migration.
  assert.match(migration, /set onboarding_status = 'exempt'\s*\n\s*where onboarding_status is null;/);

  // 2. THE EXPLICIT WRITE, in the one place a profile is created.
  const profile = code("app/api/profile/route.ts");
  assert.match(profile, /\.update\(\{ onboarding_status: "required" \}\)/);
  assert.match(profile, /\.insert\(seededBusinessName \? \{ business_name: seededBusinessName \} : \{\}\)/);
  const inserts = profile.match(/\.insert\(/g) ?? [];
  assert.equal(inserts.length, 1, "exactly one profile insert may exist");

  // 3. THE READ ITSELF, for the window before that row exists.
  assert.match(ONBOARDING_LIB,
    /if \(!profile\) \{\s*return \{\s*kind: "ready",\s*user: verified,\s*status: "required",/);

  // And the client forces (2) to run BEFORE navigating, so the gate never
  // races a profile that does not exist yet.
  const warm = SIGNUP.indexOf('fetch("/api/profile"');
  const nav = SIGNUP.indexOf('window.location.replace("/onboarding")');
  assert.ok(warm > -1 && nav > warm);
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

test("a fresh account cannot render OnboardingAllSet, and terminal states stay terminal", () => {
  // OnboardingAllSet is reachable ONLY from completed or exempt. A brand-new
  // account is neither: `required` and `skipped` both render the flow.
  assert.match(ONBOARDING_LIB,
    /return context\.status === "required" \|\| context\.status === "skipped" \? "flow" : "all_set";/);
  assert.match(PAGE, /if \(view === "all_set"\) return <OnboardingAllSet/);

  // completed and exempt are terminal — nothing a client sends moves an
  // account out of them, so a revisit to signup cannot reset one.
  assert.match(ONBOARDING_LIB, /completed: \[\],\s*exempt: \[\],/);
  // skipped is unchanged: it resumes, and it is idempotent.
  assert.match(ONBOARDING_LIB, /skipped: \["skipped", "completed"\],/);
  assert.match(ONBOARDING_LIB, /required: \["skipped", "completed"\],/);

  // And only `skipped` or `completed` may ever be written by a client.
  assert.match(code("app/api/onboarding/status/route.ts"),
    /const WRITABLE: readonly OnboardingStatus\[\] = \["skipped", "completed"\];/);

  // The two all-set wordings are still distinguished, which is what made the
  // Preview screen diagnosable: "Your account is ready" is exempt, not
  // completed — and exempt is only ever written by 005's backfill of rows that
  // predate it.
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
