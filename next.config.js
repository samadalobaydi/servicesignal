/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * /v2 → /
   *
   * Landing Page 2.0 was built at /v2 and has been promoted to the root route.
   * The page implementation now lives at app/page.tsx and app/v2 no longer
   * exists, so this is the only thing serving /v2.
   *
   * ── WHY A CONFIG REDIRECT, NOT A PAGE THAT CALLS redirect() ──────────────
   *
   * Handled in the routing layer, before any React work: no component, no
   * bundle, and — more importantly — no file under app/v2 that could quietly
   * grow back into a second landing page. The whole problem being fixed here
   * was two independently rendered public URLs for one design.
   *
   * ── WHY permanent: false (307), NOT 308 ──────────────────────────────────
   *
   * A permanent redirect is cached hard by browsers and is effectively a
   * one-way door: anyone who visits /v2 once keeps redirecting even if the
   * route were later restored. /v2 was an internal preview URL that was never
   * published, so there is no SEO value in a 308 — and until the production
   * domain is live, keeping this reversible is worth more than the marginal
   * caching benefit.
   *
   * Worth revisiting after launch: if /v2 ever leaks into a public link, flip
   * this to permanent: true.
   *
   * The fragment is NOT lost. `/v2#access` redirects to `/` and the browser
   * re-applies `#access` itself, because a hash is never sent to the server.
   */
  async redirects() {
    return [
      {
        source: "/v2",
        destination: "/",
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
