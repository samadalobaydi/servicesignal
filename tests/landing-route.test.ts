import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Landing Page 2.0 at the root route.
 *
 * The page was built at /v2 while the superseded design stayed at /, so every
 * Vercel Preview opened the old site and the current one had to be reached by
 * hand. Two independently rendered public URLs for one landing page is also
 * exactly how the two drifted apart.
 *
 * These tests fix the ROUTING, not the design: they assert which
 * implementation owns /, that no second one exists, and that public "home"
 * links point at / — while deliberately asserting nothing about the page's
 * content, which is locked and must not be edited by a routing change.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ── Who owns / ─────────────────────────────────────────────────────────────

test("[static] the root route renders the Landing Page 2.0 implementation", () => {
  const page = strip(read("app/page.tsx"));

  // Every section of the approved page, in the approved order.
  const SECTIONS = [
    "Nav", "Hero", "CustomerMessageSection", "FitsProcessSection",
    "OutcomesBand", "FaqSection", "FoundingBetaSection", "SiteFooter",
  ];
  for (const c of SECTIONS) {
    assert.match(page, new RegExp(`from "@/components/v2/${c}"`),
      `the root page must import ${c} from the approved v2 set`);
    assert.match(page, new RegExp(`<${c} ?/>`), `${c} must be rendered`);
  }

  // The approved root class, which the page's CSS is written against.
  assert.match(page, /<main className="v2-root">/);

  // Its own metadata came with it rather than falling back to the layout's.
  assert.match(page, /export const metadata: Metadata/);
  assert.match(page, /Unpaid invoices, followed up without you chasing/);
});

test("[static] the superseded landing implementation is no longer the root", () => {
  const page = read("app/page.tsx");

  // These were imported ONLY by the old app/page.tsx. If any reappears here,
  // the old design is back at /.
  for (const old of [
    "@/components/Nav", "@/components/Hero", "@/components/Problem",
    "@/components/HowItWorks", "@/components/Features", "@/components/WhoItsFor",
    "@/components/Pricing", "@/components/FAQ", "@/components/BetaSignup",
    "@/components/Footer",
  ]) {
    assert.equal(page.includes(`from "${old}"`), false,
      `${old} belongs to the superseded landing page and must not render at /`);
  }
  assert.equal(/className="lp-root"/.test(page), false,
    "lp-root was the old landing page's wrapper");
});

// ── /v2 ────────────────────────────────────────────────────────────────────

test("[static] /v2 is a redirect, not a second page", () => {
  // The route file is GONE. A redirect plus a surviving app/v2/page.tsx would
  // be ambiguous, and the file is what would quietly grow back into a second
  // landing page.
  assert.equal(existsSync(join(ROOT, "app/v2")), false,
    "app/v2 must not exist — it is served by a config redirect");
  assert.equal(existsSync(join(ROOT, "app/v2/page.tsx")), false);

  // Comments stripped FIRST: this config's own comment explains why the
  // redirect is `permanent: false`, and asserting on the raw file matched that
  // prose even after the executable value was flipped to true.
  const config = read("next.config.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(config, /async redirects\(\)/, "the redirect must be configured");
  assert.match(config, /source: "\/v2"/);
  assert.match(config, /destination: "\/"/);
  // Reversible on purpose: /v2 was an unpublished preview URL, and a 308 is
  // cached hard enough to be a one-way door before the domain is live.
  assert.match(config, /permanent: false/,
    "keep /v2 reversible until launch; revisit if it ever leaks publicly");
});

test("[static] exactly one landing-page implementation exists", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  // Any page that mounts the v2 section set is a landing page. There must be
  // exactly one, and it must be the root.
  const landings = walk(join(ROOT, "app"))
    .filter((f) => f.endsWith("page.tsx"))
    .filter((f) => /components\/v2\/FoundingBetaSection/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length));

  assert.deepEqual(landings, ["app/page.tsx"],
    "the landing page must exist at exactly one route");
});

// ── Internal links ─────────────────────────────────────────────────────────

test("[static] live public/home links point at /, not /v2", () => {
  // Each of these means "take me to the public homepage". They were pointing
  // at the preview URL.
  const LIVE = [
    "app/login/page.tsx",
    "components/auth/AuthShell.tsx",
    "components/auth/SignupForm.tsx",
    "components/auth/BetaAccessRequired.tsx",
    "components/v2/Nav.tsx",
    "components/LegalPageLayout.tsx",
    "lib/legal.ts",
  ];
  for (const f of LIVE) {
    assert.equal(/["']\/v2["']|["']\/v2#/.test(read(f)), false,
      `${f} still links to /v2; the homepage is now /`);
  }

  // The founding-beta anchor must survive the move — FoundingBetaSection
  // carries id="access", so /#access still lands in the right place.
  assert.match(read("app/login/page.tsx"), /href="\/#access"/);
  assert.match(read("components/auth/BetaAccessRequired.tsx"), /href="\/#access"/);
  assert.match(read("components/v2/FoundingBetaSection.tsx"), /id="access"/,
    "the anchor those links target must exist");
});

test("[static] remaining /v2 links are only in unreachable components", () => {
  // DashboardShell and DashNav are pre-refactor orphans that nothing imports.
  // Their /v2 links were deliberately LEFT ALONE: they are dead code, editing
  // them would widen this routing change into an unrelated cleanup, and the
  // config redirect means they would still resolve if ever revived.
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === "node_modules" || e.name.startsWith(".")
        ? [] : e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);

  const stragglers = walk(join(ROOT, "app"))
    .concat(walk(join(ROOT, "components")), walk(join(ROOT, "lib")))
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => /["']\/v2["']|["']\/v2#/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(ROOT.length))
    .sort();

  assert.deepEqual(stragglers, [
    "components/dashboard/DashNav.tsx",
    "components/dashboard/DashboardShell.tsx",
  ], "only the known orphans may still reference /v2");
});

// ── Nothing else moved ─────────────────────────────────────────────────────

test("[static] auth and dashboard routing is untouched", () => {
  // The routing change must not have altered which paths are protected.
  const mw = read("middleware.ts");
  assert.match(mw, /matcher: \["\/dashboard\/:path\*", "\/onboarding\/:path\*", "\/onboarding", "\/login", "\/signup"\]/,
    "the middleware matcher must be unchanged");
  // / and /v2 are deliberately NOT matched: the landing page is public and the
  // redirect is handled by next.config.
  assert.equal(/"\/v2"|"\/"[,\]]/.test(mw.slice(mw.indexOf("matcher"))), false,
    "middleware must not start intercepting the public landing routes");

  for (const route of [
    "app/login/page.tsx", "app/signup/page.tsx", "app/verify/page.tsx",
    "app/onboarding/page.tsx", "app/dashboard/page.tsx",
    "app/forgot-password/page.tsx", "app/reset-password/page.tsx",
  ]) {
    assert.ok(existsSync(join(ROOT, route)), `${route} must still exist`);
  }
});

test("[static] the LOCKED Overview page was not touched by this routing change", () => {
  const overview = strip(read("app/dashboard/page.tsx"));
  // Spot-checks on the approved hierarchy, so a routing pass cannot quietly
  // disturb the page that is locked.
  assert.match(overview, /const MAX_ATTENTION_ROWS = 3;/);
  assert.match(overview, /href="\/dashboard\/needs-action"/);
  assert.match(overview, /In Manual mode, you’ll review each reminder before it sends\./);
  assert.equal(/InvoiceStatusChart/.test(overview), false);
  assert.equal(/\/v2/.test(overview), false, "Overview never linked to /v2");
});
