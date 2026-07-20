import { Button, Section } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

interface PrimaryButtonProps {
  href: string;
  children: ReactNode;
}

/**
 * Solid brand-blue CTA. Uses @react-email/components' <Button>, which
 * renders the "bulletproof button" table pattern under the hood — the
 * standard fix for Outlook desktop ignoring padding on plain <a> tags.
 * Large tap target, full-width on mobile by default.
 */
export function PrimaryButton({ href, children }: PrimaryButtonProps) {
  return (
    <Section style={{ textAlign: "center", margin: "28px 0" }}>
      <Button
        href={href}
        style={{
          backgroundColor: emailTheme.colors.brand,
          color: "#ffffff",
          fontSize: 15,
          fontWeight: 650,
          borderRadius: 8,
          padding: "14px 32px",
          textDecoration: "none",
          display: "inline-block",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}
