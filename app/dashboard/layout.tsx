import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — ServiceSignal",
  description: "Manage your unpaid invoices and automated reminders.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The DashboardShell component handles the full-page layout.
  // This layout wrapper just provides metadata.
  return <>{children}</>;
}
