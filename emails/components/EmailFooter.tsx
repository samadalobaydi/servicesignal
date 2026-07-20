import { Section, Text, Link, Hr } from "@react-email/components";
import { emailTheme } from "../theme";

/**
 * Standard footer for every ServiceSignal email. Wording is fixed by
 * product decision (support contact, site, copyright) — nothing here is
 * per-email content, so it takes no props and never needs to be repeated.
 */
export function EmailFooter() {
  return (
    <>
      <Hr style={{ borderColor: emailTheme.colors.divider, margin: "36px 0 24px 0" }} />
      <Section style={{ textAlign: "center" }}>
        <Text style={{ margin: "0 0 4px 0", fontSize: 13, color: emailTheme.colors.textMuted }}>
          Need help?
        </Text>
        <Text style={{ margin: "0 0 4px 0", fontSize: 13 }}>
          <Link href="mailto:support@servicesignal.app" style={{ color: emailTheme.colors.brand, textDecoration: "none" }}>
            support@servicesignal.app
          </Link>
        </Text>
        <Text style={{ margin: "0 0 12px 0", fontSize: 13 }}>
          <Link href="https://www.servicesignal.app" style={{ color: emailTheme.colors.brand, textDecoration: "none" }}>
            www.servicesignal.app
          </Link>
        </Text>
        <Text style={{ margin: 0, fontSize: 12, color: emailTheme.colors.textSoft }}>
          © {new Date().getFullYear()} ServiceSignal. All rights reserved.
        </Text>
      </Section>
    </>
  );
}
