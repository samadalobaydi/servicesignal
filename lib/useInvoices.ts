"use client";

import { useState, useEffect, useCallback } from "react";
import type { Invoice, InvoiceFormData, InvoiceStatus } from "@/types";

const STORAGE_KEY = "ss_invoices";

// ── Helpers ────────────────────────────────────────────────────────────────

function computeStatus(invoice: Invoice): InvoiceStatus {
  if (invoice.status === "paid") return "paid";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(invoice.due_date);
  due.setHours(0, 0, 0, 0);
  return due < today ? "overdue" : "unpaid";
}

function recomputeStatuses(invoices: Invoice[]): Invoice[] {
  return invoices.map((inv) => ({
    ...inv,
    status: computeStatus(inv),
  }));
}

function loadFromStorage(): Invoice[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: Invoice[] = JSON.parse(raw);
    return recomputeStatuses(parsed);
  } catch {
    return [];
  }
}

function saveToStorage(invoices: Invoice[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(invoices));
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load from localStorage on mount (client only)
  useEffect(() => {
    setInvoices(loadFromStorage());
    setLoaded(true);
  }, []);

  const persist = useCallback((updated: Invoice[]) => {
    setInvoices(updated);
    saveToStorage(updated);
  }, []);

  const addInvoice = useCallback(
    (data: InvoiceFormData) => {
      const now = new Date().toISOString();
      const newInvoice: Invoice = {
        id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        // Migration 007 columns. This module stores invoices in localStorage
        // and collects neither field, so null is the truthful value — the same
        // thing the database holds for any invoice created without them.
        invoice_reference: null,
        job_description: null,
        customer_name: data.customer_name.trim(),
        customer_email: data.customer_email.trim(),
        customer_phone: data.customer_phone.trim(),
        amount: parseFloat(data.amount) || 0,
        due_date: data.due_date,
        payment_link: data.payment_link.trim(),
        reminder_tone: data.reminder_tone,
        reminder_schedules: data.reminder_schedules,
        status: "unpaid",
        created_at: now,
        paid_at: null,
        reminders_sent: [],
        escalation_status: "active",
      };
      // Compute correct status on creation
      newInvoice.status = computeStatus(newInvoice);
      const updated = [newInvoice, ...invoices];
      persist(updated);
      return newInvoice;
    },
    [invoices, persist]
  );

  const markPaid = useCallback(
    (id: string) => {
      const updated = invoices.map((inv) =>
        inv.id === id
          ? { ...inv, status: "paid" as const, paid_at: new Date().toISOString() }
          : inv
      );
      persist(updated);
    },
    [invoices, persist]
  );

  const deleteInvoice = useCallback(
    (id: string) => {
      const updated = invoices.filter((inv) => inv.id !== id);
      persist(updated);
    },
    [invoices, persist]
  );

  // ── Derived stats ─────────────────────────────────────────────────────────

  const stats = (() => {
    const thisMonth = new Date();
    const unpaid = invoices.filter((i) => i.status !== "paid");
    const overdue = invoices.filter((i) => i.status === "overdue");
    const paidThisMonth = invoices.filter((i) => {
      if (i.status !== "paid" || !i.paid_at) return false;
      const d = new Date(i.paid_at);
      return (
        d.getMonth() === thisMonth.getMonth() &&
        d.getFullYear() === thisMonth.getFullYear()
      );
    });
    const totalUnpaid = unpaid.reduce((sum, i) => sum + i.amount, 0);
    const totalPaidMonth = paidThisMonth.reduce((sum, i) => sum + i.amount, 0);
    const remindersScheduled = unpaid.reduce(
      (sum, i) => sum + i.reminder_schedules.length,
      0
    );

    return {
      totalUnpaid,
      overdueCount: overdue.length,
      remindersScheduled,
      paidThisMonth: totalPaidMonth,
    };
  })();

  return { invoices, loaded, addInvoice, markPaid, deleteInvoice, stats };
}
