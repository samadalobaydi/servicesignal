import { Html, Head, Body, Container, Preview } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

interface EmailLayoutProps {
  /** Shown as the inbox preview snippet — pass a short, specific summary. */
  previewText: string;
  children: ReactNode;
  /**
   * Overrides the card's own inner padding. Defaults to the original
   * "40px 40px" — every existing template (and the static Supabase
   * exports, if ever regenerated) renders identically unless a template
   * explicitly opts into a different value, e.g. less top padding when
   * a leading banner image already provides its own visual separation.
   */
  contentPadding?: string;
}

/**
 * The root wrapper every ServiceSignal email is built inside.
 *
 * Compatibility notes (why it's built this way):
 * - Outlook desktop (Windows) uses Word's rendering engine: it ignores CSS
 *   gradients, border-radius, and box-shadow entirely. `pageBg` is a solid
 *   colour fallback so Outlook still looks clean and intentional; Gmail and
 *   Apple Mail additionally render the soft radial glow layered on top,
 *   which is the closest email-safe equivalent to the auth pages' glow —
 *   genuine graceful degradation, not a broken effect.
 * - `color-scheme`/`supported-color-schemes` meta tags tell Apple Mail and
 *   other dark-mode-aware clients this design is light-only, so they should
 *   not auto-invert it. Most major clients honour this; a few (notably
 *   Outlook.com's web dark mode) may still partially override colours —
 *   a known, unsolved-by-CSS limitation worth flagging rather than
 *   overclaiming as fixed.
 * - Every colour is set as an explicit inline style (never relying on a
 *   `prefers-color-scheme` media query), which is the second half of
 *   graceful dark-mode degradation: nothing here can flip to illegible.
 */
export function EmailLayout({ previewText, children, contentPadding }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Preview>{previewText}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "40px 16px",
          fontFamily: emailTheme.font.family,
          // Solid fallback first; capable clients also see the layered glow.
          backgroundColor: emailTheme.colors.pageBg,
          backgroundImage:
            "radial-gradient(500px 300px at 20% 0%, rgba(42,95,227,0.06), transparent 70%)," +
            "radial-gradient(500px 300px at 80% 100%, rgba(14,165,196,0.05), transparent 70%)",
        }}
      >
        <Container
          style={{
            maxWidth: emailTheme.layout.emailWidth,
            margin: "0 auto",
          }}
        >
          {/* Floating card. Radius/shadow render in Gmail & Apple Mail;
              Outlook falls back to a clean square white card. */}
          <table
            role="presentation"
            width="100%"
            cellPadding={0}
            cellSpacing={0}
            style={{
              backgroundColor: emailTheme.colors.cardBg,
              border: `1px solid ${emailTheme.colors.cardBorder}`,
              borderRadius: emailTheme.layout.radius,
              boxShadow: "0 12px 40px rgba(15, 23, 42, 0.08)",
            }}
          >
            <tbody>
              <tr>
                <td style={{ padding: contentPadding ?? "40px 40px" }}>{children}</td>
              </tr>
            </tbody>
          </table>
        </Container>
      </Body>
    </Html>
  );
}
