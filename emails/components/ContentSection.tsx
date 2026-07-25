import { Section, Heading, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

interface ContentSectionProps {
  /** Optional heading shown above the body content. */
  heading?: string;
  children: ReactNode;
}

/**
 * The general-purpose body wrapper every email's main content sits inside —
 * consistent heading style and paragraph spacing, no per-email wording.
 * Plain <Text> children render as ordinary paragraphs; pass any content.
 */
export function ContentSection({ heading, children }: ContentSectionProps) {
  return (
    <Section>
      {heading && (
        <Heading
          as="h1"
          style={{
            margin: "0 0 12px 0",
            fontSize: 22,
            fontWeight: 700,
            color: emailTheme.colors.text,
            letterSpacing: "-0.01em",
            lineHeight: 1.3,
          }}
        >
          {heading}
        </Heading>
      )}
      <Text
        style={{
          margin: 0,
          fontSize: 15,
          lineHeight: 1.65,
          color: emailTheme.colors.text,
        }}
      >
        {children}
      </Text>
    </Section>
  );
}
