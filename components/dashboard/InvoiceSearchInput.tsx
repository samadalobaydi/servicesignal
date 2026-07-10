"use client";

import type { Invoice } from "@/types";

/**
 * Case-insensitive partial match against customer name, email, and phone.
 * Pure display filtering — never mutates invoice data.
 */
export function matchesInvoiceSearch(invoice: Invoice, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    invoice.customer_name ?? "",
    invoice.customer_email ?? "",
    invoice.customer_phone ?? "",
  ];
  return fields.some((f) => f.toLowerCase().includes(q));
}

interface InvoiceSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function InvoiceSearchInput({ value, onChange, placeholder }: InvoiceSearchInputProps) {
  return (
    <div className="relative max-w-md">
      <svg
        width="16"
        height="16"
        fill="none"
        viewBox="0 0 24 24"
        className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: "var(--dash-text-soft)" }}
      >
        <path d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        className="dash-input"
        style={{ paddingLeft: "2.4rem" }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

/** Friendly empty state shown when a search finds nothing. */
export function SearchEmptyState() {
  return (
    <div className="dash-card p-10 text-center">
      <p style={{ fontWeight: 650, fontSize: "1.02rem", color: "var(--dash-text)" }}>No invoices found</p>
      <p className="text-sm mt-1.5" style={{ color: "var(--dash-text-muted)" }}>
        Try searching by customer name, email, or phone number.
      </p>
    </div>
  );
}
