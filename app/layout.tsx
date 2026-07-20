import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServiceSignal — Stop Chasing Late Payments",
  description:
    "ServiceSignal automatically follows up with customers who have unpaid invoices, so tradesmen and local service businesses get paid faster — without the awkward chasing.",
  keywords:
    "invoice reminders, unpaid invoices, tradesman software, get paid faster, invoice chasing, builder software, electrician software",
  openGraph: {
    title: "ServiceSignal — Stop Chasing Late Payments",
    description:
      "Automatic invoice reminders for tradesmen and local service businesses. Get paid faster without the awkward chasing.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
