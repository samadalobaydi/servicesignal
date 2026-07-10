import type { Metadata } from "next";
import { DashboardProvider } from "@/components/dashboard/DashboardProvider";
import DashboardChrome from "@/components/dashboard/DashboardChrome";

export const metadata: Metadata = {
  title: "Dashboard — ServiceSignal",
  description: "Manage your unpaid invoices and automated reminders.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardProvider>
  );
}
