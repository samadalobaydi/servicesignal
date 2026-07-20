import { Hr } from "@react-email/components";
import { emailTheme } from "../theme";

/** Thin horizontal rule for separating sections within an email body. */
export function Divider() {
  return <Hr style={{ borderColor: emailTheme.colors.divider, margin: "24px 0" }} />;
}
