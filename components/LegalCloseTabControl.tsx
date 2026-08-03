"use client";

import { useRef, useState } from "react";
import Link from "next/link";

interface LegalCloseTabControlProps {
  /** Last-resort destination if the visitor genuinely lost the original tab. */
  fallbackHref: string;
}

/**
 * The signup-context return control.
 *
 * Terms and Privacy open in their own tab from the signup consent line. The
 * correct action there is to CLOSE that tab, revealing the original signup
 * form with everything the visitor had already typed. Navigating this tab to
 * /signup instead would create a second, empty form and make their details
 * look erased — the bug this replaces.
 *
 * Why window.close() is expected to work despite rel="noopener":
 * the HTML spec permits closing a top-level browsing context whose session
 * history contains only one Document. A tab opened via target="_blank" that
 * has not navigated satisfies that, independently of whether it has an
 * opener. So `window.opener` is NOT the right capability test — it is always
 * null under noopener, and testing it would disable this permanently.
 *
 * It can still legitimately fail: if the visitor navigated within this tab
 * (Terms then Privacy, say) the session history holds more than one Document
 * and the browser refuses. Firefox has also historically restricted this.
 *
 * When it fails, the primary response is a MESSAGE, not a link. Because
 * rel="noopener" prevents sessionStorage being copied into this tab, sending
 * the visitor to /signup from here would land them on an empty form — exactly
 * the problem being fixed. The original tab still holds their work, so the
 * useful thing to tell them is that it is still there. "Open signup again" is
 * kept as a quiet secondary route for anyone who really did lose that tab,
 * and deliberately promises nothing about restoring what they typed.
 *
 * This is the only client component on the legal pages; the layout and both
 * documents remain server components.
 */
export function LegalCloseTabControl({ fallbackHref }: LegalCloseTabControlProps) {
  const [blocked, setBlocked] = useState(false);
  const messageRef = useRef<HTMLParagraphElement | null>(null);

  const attemptClose = () => {
    try {
      window.close();
    } catch {
      // Some browsers throw rather than silently refusing.
    }

    // Still here a moment later means the browser declined.
    window.setTimeout(() => {
      if (!window.closed) {
        setBlocked(true);
        // Move focus to the explanation so keyboard and screen-reader users
        // land on it rather than on a button that no longer does anything.
        window.requestAnimationFrame(() => messageRef.current?.focus());
      }
    }, 250);
  };

  // aria-live announces the swap without any always-visible instructional copy.
  return (
    <div role="status" aria-live="polite" className="v2-legal-close">
      {blocked ? (
        <>
          <p className="v2-legal-close-msg" ref={messageRef} tabIndex={-1}>
            This tab couldn&rsquo;t close automatically. Close it to return to your
            signup form — it&rsquo;s still open in the previous tab, with the details
            you entered.
          </p>
          <Link href={fallbackHref} className="v2-legal-close-alt">
            Open signup again
          </Link>
        </>
      ) : (
        <button type="button" onClick={attemptClose} className="v2-legal-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Close this tab
        </button>
      )}
    </div>
  );
}
