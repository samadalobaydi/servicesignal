import "server-only";

import { classifyTwilioError } from "./twilio-send-state";

/**
 * Twilio SMS transport.
 *
 * ── WHY THE REST API AND NOT THE `twilio` SDK ─────────────────────────────
 *
 * Creating a message is one form-encoded POST with Basic auth. The SDK would
 * add a dependency with a large transitive tree to this project's four runtime
 * packages, and it brings its own retry behaviour — which is precisely the
 * thing this send path must control itself, because an automatic retry after
 * an ambiguous result is how a customer receives the same text twice.
 *
 * `import "server-only"` is the structural guarantee, not a convention: if any
 * client component ever imports this file the BUILD fails, so the credentials
 * cannot reach a browser bundle by accident.
 *
 * ── SENDER IDENTITY ───────────────────────────────────────────────────────
 *
 * MessagingServiceSid, never a raw `from` number. The Messaging Service owns
 * the sender pool, the UK regulatory bundle, sticky sender and opt-out
 * handling; naming a number here would move all of that into application
 * config and turn a Twilio change into a redeploy. The SID itself is read from
 * the environment, so no account identifier is compiled into the source.
 */

const MESSAGES_ENDPOINT = (accountSid: string) =>
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;

/** How long a single create may take before we give up and call it ambiguous. */
const REQUEST_TIMEOUT_MS = 15_000;

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
}

/**
 * Reads configuration, or null when it is incomplete.
 *
 * Returns null rather than throwing, exactly like getResendClient(): a missing
 * credential must produce a handled refusal on the send path, never a crashed
 * request. All three are server-only — none carries a NEXT_PUBLIC_ prefix, and
 * a test asserts that.
 */
export function getTwilioConfig(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();

  if (!accountSid || !authToken || !messagingServiceSid) {
    console.warn(
      "\x1b[33m⚠ ServiceSignal: Twilio is not fully configured.\x1b[0m\n" +
        "  SMS reminders cannot be sent until TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN\n" +
        "  and TWILIO_MESSAGING_SERVICE_SID are all set (server-side only)."
    );
    return null;
  }

  return { accountSid, authToken, messagingServiceSid };
}

/**
 * Outcome of the Message-create call, discriminated by `kind`.
 *
 * `rejected` and `ambiguous` are exactly the two outcomes classifyTwilioError
 * can return (see lib/twilio-send-state.ts) — this type just makes them the
 * two failure shapes instead of a single `ok: false` shape callers had to
 * re-derive by calling the classifier themselves.
 */
export type TwilioSendResult =
  | {
      kind: "accepted";
      /** Twilio's Message SID (SM…), stored for later reconciliation. */
      id: string;
      /** Message status as created — queued / accepted / sending. */
      status: string | null;
      httpStatus: number;
    }
  | {
      kind: "rejected";
      /** Numeric Twilio error code, when the payload carried one. */
      code: number | null;
      httpStatus: number;
      message: string;
    }
  | {
      kind: "ambiguous";
      /** Numeric Twilio error code, or null when the call never reached Twilio. */
      code: number | null;
      /** HTTP status, or null on a timeout/abort/network failure. */
      httpStatus: number | null;
      message: string;
    };

/**
 * Creates one message.
 *
 * NOTE ON IDEMPOTENCY. Twilio's Message-create API has no Idempotency-Key
 * header equivalent to Resend's, so at-most-once submission cannot be delegated
 * to the provider for SMS the way it is for email. The guarantee here comes
 * from the caller instead: an atomic conditional UPDATE claims the channel row
 * into `sending` before this is called, so only one request can ever reach it
 * for a given attempt. That is a weaker guarantee than email's and it is stated
 * plainly rather than implied.
 */
export async function sendTwilioSms(
  config: TwilioConfig,
  params: { to: string; body: string }
): Promise<TwilioSendResult> {
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");

  const form = new URLSearchParams({
    MessagingServiceSid: config.messagingServiceSid,
    To: params.to,
    Body: params.body,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(MESSAGES_ENDPOINT(config.accountSid), {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | { sid?: string; status?: string; code?: number; message?: string }
      | null;

    if (!response.ok) {
      const code = typeof payload?.code === "number" ? payload.code : null;
      // Twilio's own message text. Logged, never shown to a customer.
      const message = payload?.message ?? `Twilio returned HTTP ${response.status}`;

      if (classifyTwilioError(code, response.status) === "rejected") {
        return { kind: "rejected", code, httpStatus: response.status, message };
      }
      // 5xx, or an unrecognised code outside the 4xx band — Twilio may or may
      // not have queued the message. Never retried automatically.
      return { kind: "ambiguous", code, httpStatus: response.status, message };
    }

    const sid = payload?.sid;
    if (typeof sid === "string" && sid.length > 0) {
      return { kind: "accepted", id: sid, status: payload?.status ?? null, httpStatus: response.status };
    }
    // A 2xx carrying no usable SID is not a success we can stand behind.
    return {
      kind: "ambiguous",
      code: null,
      httpStatus: response.status,
      message: `Twilio returned HTTP ${response.status} without a usable message SID`,
    };
  } catch (err) {
    // Abort, DNS failure, dropped socket. We do not know whether Twilio
    // received the request — the caller must treat this as ambiguous.
    return {
      kind: "ambiguous",
      code: null,
      httpStatus: null,
      message: err instanceof Error ? err.message : "Unknown Twilio transport error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reads one Message resource, for delivery reconciliation.
 *
 * ── WHY POLLING AND NOT A WEBHOOK ────────────────────────────────────────
 *
 * A status-callback webhook is a new PUBLIC endpoint that must validate
 * Twilio's signature on every request, and getting that wrong turns a delivery
 * receipt into a way for anyone to rewrite a reminder's state. Polling reuses
 * the credentials and the cron that already exist and adds no attack surface.
 * Worth revisiting when volume justifies it; not for beta.
 *
 * Returns `found: false` for a 404 and `ok: false` for anything else, so the
 * caller can tell "no such message" from "we could not ask" — and treat the
 * second as ambiguity rather than as a delivery failure.
 */
export interface TwilioMessageLookup {
  ok: boolean;
  found: boolean;
  status: string | null;
  /** Twilio's own error code on a failed message, for logs only. */
  errorCode: number | null;
  message: string;
}

export async function fetchTwilioMessage(
  config: TwilioConfig,
  messageSid: string
): Promise<TwilioMessageLookup> {
  const auth = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const url =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}` +
    `/Messages/${encodeURIComponent(messageSid)}.json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return { ok: true, found: false, status: null, errorCode: null, message: "not found" };
    }

    const payload = (await response.json().catch(() => null)) as
      | { status?: string; error_code?: number | null; message?: string }
      | null;

    if (!response.ok) {
      return {
        ok: false,
        found: false,
        status: null,
        errorCode: typeof payload?.error_code === "number" ? payload.error_code : null,
        message: payload?.message ?? `Twilio returned HTTP ${response.status}`,
      };
    }

    return {
      ok: true,
      found: true,
      status: payload?.status ?? null,
      errorCode: typeof payload?.error_code === "number" ? payload.error_code : null,
      message: "ok",
    };
  } catch (err) {
    // We could not ask. NOT a delivery failure — the row is left exactly where
    // it is and the next run re-asks.
    return {
      ok: false,
      found: false,
      status: null,
      errorCode: null,
      message: err instanceof Error ? err.message : "Unknown Twilio lookup error",
    };
  } finally {
    clearTimeout(timeout);
  }
}
