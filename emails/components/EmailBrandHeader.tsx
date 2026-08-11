import { Section } from "@react-email/components";
import { emailTheme } from "../theme";

/**
 * The current ServiceSignal lockup, for email.
 *
 * WHY THIS IS AN IMAGE PLUS LIVE TEXT, NOT ONE IMAGE
 *
 * Every complete lockup asset in /public/branding was inspected against a
 * white card, and none is usable here:
 *
 *   servicesignal-email-logo.png  — opaque RGB (no alpha). This is the dark
 *                                   rectangular banner being replaced.
 *   servicesignal-wordmark-dark.png — transparent, but "Service" is near-white
 *                                   (invisible on a white card) AND the legacy
 *                                   tagline is baked into the artwork.
 *   servicesignal-auth-logo.png   — transparent with correct navy/blue, but the
 *                                   legacy tagline is baked in.
 *   servicesignal-legal-logo.png  — same 2048x826 banner shape.
 *
 * So the wordmark is set as real HTML text beside the one asset that is
 * genuinely clean: servicesignal-mark.png, a transparent blue mark with no
 * text of any kind.
 *
 * This is better than a bespoke image would be. Roughly half of recipients
 * have images off by default, and live text means the brand still reads as
 * "ServiceSignal" in the correct colours when the mark never loads — where a
 * single logo image degrades to an empty box or a string of alt text.
 *
 * EMAIL-SAFE CONSTRUCTION. A centred <table> with two cells, not flexbox or
 * inline-block, because Outlook's Word rendering engine supports neither.
 * Dimensions are explicit pixel attributes as well as CSS, since Outlook
 * ignores height:auto. vertical-align:middle on both cells is what keeps the
 * mark optically aligned with the wordmark.
 *
 * The mark's alt is deliberately EMPTY. The word "ServiceSignal" sits
 * immediately beside it as real text, so alt text on the mark would make a
 * screen reader announce the brand twice, and would print a redundant
 * placeholder string next to the visible wordmark when images are blocked.
 * The accessible name is carried by the text, which is the more robust place
 * for it.
 */

/** Natural artwork is 875x1366 (measured, not assumed) — aspect 0.6406 w/h. */
const MARK_HEIGHT = 36;
const MARK_WIDTH = 23; // 36 * (875/1366) = 23.1

export function EmailBrandHeader({
  /** Space beneath the lockup. Templates that follow it with their own
   *  spacing can tighten this without redefining the whole header. */
  marginBottom = 28,
}: {
  marginBottom?: number;
} = {}) {
  return (
    <Section style={{ textAlign: "center", marginBottom }}>
      <table
        role="presentation"
        border={0}
        cellPadding={0}
        cellSpacing={0}
        align="center"
        style={{ margin: "0 auto", borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td style={{ verticalAlign: "middle", paddingRight: 10 }}>
              <img
                src={`${emailTheme.assetsBaseUrl}/branding/servicesignal-mark.png`}
                alt=""
                width={MARK_WIDTH}
                height={MARK_HEIGHT}
                style={{
                  display: "block",
                  border: 0,
                  outline: "none",
                  textDecoration: "none",
                  width: MARK_WIDTH,
                  height: MARK_HEIGHT,
                }}
              />
            </td>
            <td
              style={{
                verticalAlign: "middle",
                fontFamily: emailTheme.font.family,
                fontSize: 25,
                fontWeight: 700,
                letterSpacing: "-0.015em",
                lineHeight: "30px",
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ color: emailTheme.colors.text }}>Service</span>
              <span style={{ color: emailTheme.colors.brand }}>Signal</span>
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
