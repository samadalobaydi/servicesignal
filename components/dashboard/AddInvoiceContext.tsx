"use client";

import { createContext, useContext } from "react";

/**
 * Opens the real Add Invoice form.
 *
 * WHY THIS EXISTS
 *
 * "Add Invoice" is not a route. It is a modal whose open/closed state lives in
 * DashboardChrome, rendered by AddInvoiceForm. Anything outside that component
 * therefore had no way to trigger it — so the Overview's zero-invoice CTA
 * linked to /dashboard/chasing instead, a page with no add-invoice control on
 * it. The one action a brand-new account exists to perform led somewhere it
 * could not be performed.
 *
 * This context shares the opener rather than duplicating the form. There is
 * still exactly one AddInvoiceForm, one piece of state and one submit path;
 * the top bar and the first-run card are two buttons calling the same
 * function.
 */
const AddInvoiceContext = createContext<(() => void) | null>(null);

export const AddInvoiceProvider = AddInvoiceContext.Provider;

export function useOpenAddInvoice(): () => void {
  const open = useContext(AddInvoiceContext);
  if (!open) {
    throw new Error("useOpenAddInvoice must be used within DashboardChrome");
  }
  return open;
}
