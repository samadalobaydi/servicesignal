import { Section } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

export type CalloutTone = "info" | "success" | "warning" | "danger";

interface CalloutBoxProps {
  tone?: CalloutTone;
  children: ReactNode;
}

const TONE_STYLES: Record<CalloutTone, { bg: string; border: string; text: string }> = {
  info:    { bg: emailTheme.colors.infoSoft,    border: emailTheme.colors.brand,   text: emailTheme.colors.text },
  success: { bg: emailTheme.colors.successSoft, border: emailTheme.colors.success, text: emailTheme.colors.text },
  warning: { bg: emailTheme.colors.warningSoft, border: emailTheme.colors.warning, text: emailTheme.colors.text },
  danger:  { bg: emailTheme.colors.dangerSoft,  border: emailTheme.colors.danger,  text: emailTheme.colors.text },
};

/**
 * A bordered, tinted box for invoice/payment alerts — amount due, overdue
 * status, payment confirmation, etc. Mirrors the dashboard's tone system
 * (cyan/green/amber/red) so the visual language stays consistent across
 * product and email. Table-based left border for Outlook reliability
 * (a CSS `border-left` alone can be dropped by some Outlook builds).
 */
export function CalloutBox({ tone = "info", children }: CalloutBoxProps) {
  const s = TONE_STYLES[tone];
  return (
    <Section style={{ margin: "20px 0" }}>
      <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td style={{ width: 4, backgroundColor: s.border, borderRadius: "4px 0 0 4px" }} />
            <td
              style={{
                backgroundColor: s.bg,
                borderRadius: "0 8px 8px 0",
                padding: "16px 20px",
                color: s.text,
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {children}
            </td>
          </tr>
        </tbody>
      </table>
    </Section>
  );
}
