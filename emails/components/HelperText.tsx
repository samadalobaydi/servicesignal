import { Text } from "@react-email/components";
import type { ReactNode } from "react";
import { emailTheme } from "../theme";

interface HelperTextProps {
  children: ReactNode;
  /** Centre for things like "if the button doesn't work" fallback lines. */
  center?: boolean;
}

/** Small muted text — fallback links, fine print, secondary explanations. */
export function HelperText({ children, center = false }: HelperTextProps) {
  return (
    <Text
      style={{
        margin: "8px 0 0 0",
        fontSize: 12.5,
        lineHeight: 1.6,
        color: emailTheme.colors.textSoft,
        textAlign: center ? "center" : "left",
      }}
    >
      {children}
    </Text>
  );
}
