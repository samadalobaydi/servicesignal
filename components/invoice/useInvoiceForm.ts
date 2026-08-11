"use client";

import { useCallback, useEffect, useState } from "react";
import type { InvoiceFormData, ReminderSchedule } from "@/types";
import {
  EMPTY_INVOICE_FORM,
  PRESETS,
  presetForSchedules,
  validateInvoiceForm,
  normaliseInvoiceForm,
  type InvoiceFormErrors,
  type PresetKey,
} from "@/lib/invoice-form";

export interface UseInvoiceFormOptions {
  /** See ValidateOptions — off by default so the dashboard cannot regress. */
  requireReminderEligibility?: boolean;
  /** Onboarding-only field requirements. Off by default, same reason. */
  requireOnboardingFields?: boolean;
  /** Starting values. Only the fields given are overlaid on the blank form. */
  initial?: Partial<InvoiceFormData>;
}

export interface InvoiceFormState {
  form: InvoiceFormData;
  errors: InvoiceFormErrors;
  preset: PresetKey;
  setField: <K extends keyof InvoiceFormData>(field: K, value: InvoiceFormData[K]) => void;
  toggleSchedule: (schedule: ReminderSchedule) => void;
  selectPreset: (key: PresetKey) => void;
  reset: () => void;
  /**
   * Validates and returns the normalised data, or null when invalid — in which
   * case `errors` has been populated. Returning the data rather than a boolean
   * means a caller cannot accidentally submit the untrimmed form.
   */
  validateAndGet: () => InvoiceFormData | null;
}

/**
 * Form state for both invoice surfaces.
 *
 * Extracted from AddInvoiceForm so the onboarding step gets identical
 * behaviour rather than a second implementation that drifts. The drawer's
 * modal concerns — open/close, Escape, the overlay — deliberately stay in the
 * drawer: onboarding is a full page with no overlay and no Escape-to-dismiss,
 * so folding those in here would force it to opt out of its own container.
 */
export function useInvoiceForm(options: UseInvoiceFormOptions = {}): InvoiceFormState {
  const { requireReminderEligibility = false, requireOnboardingFields = false, initial } = options;

  const build = useCallback(
    (): InvoiceFormData => ({ ...EMPTY_INVOICE_FORM, ...initial }),
    // Callers pass an object literal, so a reference check would rebuild on
    // every render. The field values are what actually matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(initial ?? {})]
  );

  const [form, setForm] = useState<InvoiceFormData>(build);
  const [errors, setErrors] = useState<InvoiceFormErrors>({});
  const [preset, setPreset] = useState<PresetKey>(() =>
    presetForSchedules(build().reminder_schedules)
  );

  const reset = useCallback(() => {
    const next = build();
    setForm(next);
    setErrors({});
    setPreset(presetForSchedules(next.reminder_schedules));
  }, [build]);

  // Re-seed when the initial values genuinely change — the onboarding step
  // loads its prefill asynchronously, so the first render has nothing yet.
  useEffect(() => {
    reset();
  }, [reset]);

  const setField = useCallback(
    <K extends keyof InvoiceFormData>(field: K, value: InvoiceFormData[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      // Clear this field's error as soon as it is edited. Leaving it up while
      // the user types the correction reads as though the fix was rejected.
      setErrors((prev) => {
        if (!prev[field]) return prev;
        const next = { ...prev };
        delete next[field];
        return next;
      });
    },
    []
  );

  const toggleSchedule = useCallback((schedule: ReminderSchedule) => {
    setForm((prev) => {
      const schedules = prev.reminder_schedules.includes(schedule)
        ? prev.reminder_schedules.filter((s) => s !== schedule)
        : [...prev.reminder_schedules, schedule];
      return { ...prev, reminder_schedules: schedules };
    });
    setErrors((prev) => {
      if (!prev.reminder_schedules) return prev;
      const next = { ...prev };
      delete next.reminder_schedules;
      return next;
    });
  }, []);

  const selectPreset = useCallback((key: PresetKey) => {
    setPreset(key);
    const chosen = PRESETS.find((p) => p.key === key);
    // Light/Standard/Firm replace the schedule outright; Custom keeps whatever
    // is currently ticked so switching to it is never destructive.
    if (chosen?.schedules) {
      setForm((prev) => ({ ...prev, reminder_schedules: [...chosen.schedules!] }));
      setErrors((prev) => {
        if (!prev.reminder_schedules) return prev;
        const next = { ...prev };
        delete next.reminder_schedules;
        return next;
      });
    }
  }, []);

  const validateAndGet = useCallback((): InvoiceFormData | null => {
    const found = validateInvoiceForm(form, {
      requireReminderEligibility,
      requireOnboardingFields,
    });
    setErrors(found);
    return Object.keys(found).length === 0 ? normaliseInvoiceForm(form) : null;
  }, [form, requireReminderEligibility, requireOnboardingFields]);

  return { form, errors, preset, setField, toggleSchedule, selectPreset, reset, validateAndGet };
}
