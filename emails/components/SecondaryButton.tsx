import { Section, Link } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

interface SecondaryButtonProps {
  href: string;
  children: ReactNode;
}

/**
 * Lower-emphasis action, styled as a plain text link rather than a filled
 * button — use for "Manage preferences", "View in browser", etc., where a
 * PrimaryButton would compete with the email's main call to action.
 */
export function SecondaryButton({ href, children }: SecondaryButtonProps) {
  return (
    <Section style={{ textAlign: "center", margin: "16px 0" }}>
      <Link
        href={href}
        style={{
          color: emailTheme.colors.brand,
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {children}
      </Link>
    </Section>
  );
}
