import { Img, Section, Text } from "@react-email/components";
import { emailTheme } from "../theme";

interface EmailHeaderProps {
  /** Override only if a future variant needs different wording. */
  tagline?: string;
}

/**
 * Logo + tagline, centred above the card content. Uses the same auth-page
 * logo asset via an absolute URL (email clients cannot load from the app
 * bundle). If the production domain changes, update emailTheme.assetsBaseUrl.
 */
export function EmailHeader({
  tagline = "AUTOMATED INVOICE CHASING FOR UK BUSINESSES.",
}: EmailHeaderProps) {
  return (
    <Section style={{ textAlign: "center", marginBottom: 32 }}>
      <Img
        src={`${emailTheme.assetsBaseUrl}/branding/servicesignal-auth-logo.png`}
        alt="ServiceSignal"
        width={220}
        style={{ margin: "0 auto", display: "block", height: "auto" }}
      />
      <Text
        style={{
          margin: "10px 0 0 0",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: emailTheme.colors.textSoft,
        }}
      >
        {tagline}
      </Text>
    </Section>
  );
}
