/**
 * Transient-error classification for autonomous-mission drift-robustness (M3
 * Trin 3, "survive the night"). This lives in shared — NOT pure core — because it
 * inspects provider/HTTP/socket error shapes; core only ever receives an injected
 * `(err) => boolean` predicate.
 *
 * Two uses, one source of truth:
 *  1. `llmRetryOnFailedAttempt` is handed to every LangChain chat model
 *     (`buildModel`) as `onFailedAttempt`, so the model's built-in AsyncCaller
 *     retries ONLY transient failures with exponential backoff + jitter, and
 *     re-throws everything else immediately.
 *  2. `isTransientLlmError` is injected into the mission controller
 *     (`deps.isTransientError`) so an item whose run throws a transient/infra
 *     error is re-queued instead of parked as a logic failure.
 *
 * Invariant ("robusthed ≠ skjule fejl"): only genuinely transient errors retry.
 * A 4xx (e.g. 401/403/404/409/422 — but NOT 408 request-timeout, which IS
 * retried), auth/quota, an abort/cancel (the kill switch), or a status-less logic
 * error (e.g. a structured-output parse failure) is NOT transient — it surfaces
 * immediately so a real failure is never hidden.
 */
import { AsyncCaller } from "@langchain/core/utils/async_caller";

/** HTTP statuses worth retrying: request-timeout, too-early, rate-limit, and 5xx (incl. Anthropic's 529 "overloaded"). */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 529]);

/** Node/undici socket error codes that mean "try again" (network blip, not a logic fault). */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

type Errorish = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown };
  error?: { code?: unknown };
  /** SDKs wrap the real socket error here (e.g. Anthropic's status-less APIConnectionError). */
  cause?: unknown;
};

/**
 * True for errors that are worth retrying (rate-limit / 5xx / network / timeout),
 * false for everything else. Abort/cancel and explicit quota exhaustion are
 * deliberately NOT transient, so the kill switch is honoured and a dead key fails
 * fast rather than looping all night.
 */
export function isTransientLlmError(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Errorish;
  const name = String(e.name ?? "");
  const message = String(e.message ?? "");

  // Never retry an abort/cancel — the mission kill switch must propagate. Checked
  // first at EVERY recursion level, so a wrapped cause can never resurrect an abort.
  if (
    name === "AbortError" ||
    message.startsWith("AbortError") ||
    message.startsWith("Cancel") ||
    e.code === "ECONNABORTED"
  ) {
    return false;
  }
  // Quota exhaustion is not a passing blip — surface it.
  if (e.code === "insufficient_quota" || e.error?.code === "insufficient_quota") return false;

  const status =
    typeof e.status === "number"
      ? e.status
      : typeof e.response?.status === "number"
        ? e.response.status
        : undefined;
  if (typeof status === "number") return TRANSIENT_STATUS.has(status);

  if (typeof e.code === "string" && TRANSIENT_CODES.has(e.code)) return true;

  // Status-less errors: only network/timeout SHAPES are transient. A plain
  // logic/parse error (no status, no network signature) is surfaced, not retried.
  // "connection error" / "terminated" / "other side closed" cover SDK wrappers
  // (Anthropic APIConnectionError, undici) that hide the socket error behind a
  // generic message.
  if (
    /\b(timeout|timed out|socket hang up|network|fetch failed|connection error|terminated|other side closed|econnreset|etimedout)\b/i.test(
      message,
    )
  ) {
    return true;
  }

  // Many SDKs stash the REAL socket error in `.cause` while presenting a
  // status-less, generic message (e.g. Anthropic's "Connection error."). Recurse a
  // bounded depth so the wrapped ECONNRESET/timeout is honoured. The abort/quota/
  // status guards above run at each level, so this never rescues a real failure.
  if (depth < 3 && e.cause && typeof e.cause === "object") {
    return isTransientLlmError(e.cause, depth + 1);
  }

  return false;
}

/**
 * `onFailedAttempt` for LangChain's AsyncCaller. The handler signals "retry" by
 * returning and "stop" by THROWING — so we re-throw any non-transient error
 * (surfacing it unchanged after the first attempt) and return for transient ones
 * (letting the caller's exponential backoff + jitter run up to `maxRetries`).
 */
export function llmRetryOnFailedAttempt(error: unknown): void {
  if (!isTransientLlmError(error)) throw error;
}

/**
 * Route a provider's `completionWithRetry` through OUR AsyncCaller so the
 * transient-only policy + backoff/jitter apply uniformly.
 *
 * Why this exists: most LangChain chat models honour the `onFailedAttempt` we pass
 * in the constructor (it lands on `this.caller`), but `ChatMistralAI` builds a
 * FRESH `AsyncCaller` per request and never touches `this.caller` — so our handler
 * is silently dropped and its requests fall back to LangChain's retry-by-default
 * predicate (the inverse of ours: it would retry a 422 / status-less logic error
 * the full budget). For such a provider we construct it with `maxRetries: 0` (its
 * inner caller does a single attempt and re-throws) and wrap its single network
 * entry point here.
 *
 * Feature-detected and signature-agnostic: if `completionWithRetry` is absent (a
 * future version), the model is returned untouched rather than crashing.
 */
export function routeCompletionThroughTransientRetry<T extends object>(
  model: T,
  maxRetries: number,
): T {
  const target = model as { completionWithRetry?: (...args: unknown[]) => Promise<unknown> };
  const orig = target.completionWithRetry;
  if (typeof orig !== "function") return model;
  const caller = new AsyncCaller({ maxRetries, onFailedAttempt: llmRetryOnFailedAttempt });
  const bound = orig.bind(model);
  target.completionWithRetry = (...args: unknown[]) => caller.call(() => bound(...args));
  return model;
}
