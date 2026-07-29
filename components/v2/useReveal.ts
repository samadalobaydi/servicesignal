"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scroll reveal via IntersectionObserver.
 *
 * Lightweight by design: no scroll listeners, no animation library. The
 * observer flips a single class, and all movement is CSS transform/opacity
 * so it stays on the compositor.
 *
 * Reduced motion is handled in CSS (.v2-reveal rules), so the narrative
 * order is preserved without any travel animation.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options?: { threshold?: number; once?: boolean; rootMargin?: string }
) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  const threshold = options?.threshold ?? 0.18;
  const once = options?.once ?? true;
  const rootMargin = options?.rootMargin ?? "0px 0px -8% 0px";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // If the browser can't observe, show everything immediately.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setInView(true);
            if (once) observer.unobserve(entry.target);
          } else if (!once) {
            setInView(false);
          }
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(el);

    // Safety net: content must never remain invisible. If the observer has
    // not fired shortly after mount, reveal anyway.
    const failsafe = window.setTimeout(() => setInView(true), 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [threshold, once, rootMargin]);

  return { ref, inView };
}
