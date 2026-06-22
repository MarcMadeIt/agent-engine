/**
 * Throwaway proof for M3 Trin 3 LLM-level retry (drift-robustness). Proves the
 * transient classifier, the onFailedAttempt handler's retry/stop semantics, and —
 * end-to-end through the REAL LangChain AsyncCaller (the same engine buildModel
 * wires onto every provider) — that a transient error is retried with backoff to
 * success while a non-transient one surfaces after a single attempt. No API key,
 * no network.
 * Run: pnpm --filter @arzonic/agent-shared exec tsx verify-retry.ts
 */
import { AsyncCaller } from "@langchain/core/utils/async_caller";
import {
  isTransientLlmError,
  llmRetryOnFailedAttempt,
  routeCompletionThroughTransientRetry,
} from "./src/retry.js";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};

const httpStatus = (s: number) => Object.assign(new Error(`http ${s}`), { status: s });
const sockCode = (c: string) => Object.assign(new Error(c), { code: c });

// ── 1. classification: only rate-limit / 5xx / timeout / network are transient ──
for (const s of [408, 425, 429, 500, 502, 503, 504, 529]) {
  ok(isTransientLlmError(httpStatus(s)), `status ${s} is transient (retry)`);
}
for (const s of [400, 401, 403, 404, 409, 422]) {
  ok(!isTransientLlmError(httpStatus(s)), `status ${s} is NOT transient (surface)`);
}
for (const c of ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"]) {
  ok(isTransientLlmError(sockCode(c)), `socket code ${c} is transient`);
}
ok(isTransientLlmError({ response: { status: 503 } }), "status on error.response.status is read too");
ok(isTransientLlmError(new Error("upstream socket hang up")), "status-less network message is transient");
ok(!isTransientLlmError(new Error("Could not parse structured output")), "a status-less logic error is NOT transient");
ok(!isTransientLlmError(Object.assign(new Error("aborted"), { name: "AbortError" })), "AbortError is NOT transient (kill switch must propagate)");
ok(!isTransientLlmError(sockCode("ECONNABORTED")), "ECONNABORTED (cancel) is NOT transient");
ok(!isTransientLlmError(Object.assign(new Error("quota"), { error: { code: "insufficient_quota" } })), "insufficient_quota is NOT transient");
ok(!isTransientLlmError(undefined) && !isTransientLlmError("oops") && !isTransientLlmError(null), "non-object errors are NOT transient");

// ── 2. onFailedAttempt: return (retry) on transient, THROW the original (stop) otherwise ──
{
  let threw = false;
  try {
    llmRetryOnFailedAttempt(httpStatus(503));
  } catch {
    threw = true;
  }
  ok(!threw, "onFailedAttempt does NOT throw on a transient error (retry allowed)");

  const fatal = httpStatus(400);
  let caught: unknown;
  try {
    llmRetryOnFailedAttempt(fatal);
  } catch (e) {
    caught = e;
  }
  ok(caught === fatal, "onFailedAttempt re-throws the ORIGINAL non-transient error (retry stops, surfaced)");
}

// ── 3. real AsyncCaller: transient retried with backoff to success; non-transient fails fast ──
{
  const caller = new AsyncCaller({ maxRetries: 4, onFailedAttempt: llmRetryOnFailedAttempt });
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls <= 2) throw httpStatus(503);
    return `ok-${calls}`;
  };
  const out = await caller.call(flaky);
  ok(out === "ok-3" && calls === 3, "a transient failure is retried (backoff+jitter) until it succeeds — 2 fails then ok");
}
{
  const caller = new AsyncCaller({ maxRetries: 4, onFailedAttempt: llmRetryOnFailedAttempt });
  let calls = 0;
  let rejected = false;
  try {
    await caller.call(async () => {
      calls++;
      throw httpStatus(400);
    });
  } catch {
    rejected = true;
  }
  ok(rejected && calls === 1, "a non-transient error is NOT retried — it surfaces after a single attempt");
}

// ── 4. wrapped status-less errors: the real socket error in .cause is honoured ──
{
  const opaqueWithSocketCause = Object.assign(new Error("Request failed"), {
    cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
  });
  ok(isTransientLlmError(opaqueWithSocketCause), "a status-less opaque error whose .cause is a socket error is transient (cause inspected)");
  ok(isTransientLlmError(new Error("Connection error.")), "Anthropic-style 'Connection error.' message is transient");
  ok(isTransientLlmError(new Error("terminated")), "undici 'terminated' message is transient");

  const abortWithSocketCause = Object.assign(new Error("aborted"), {
    name: "AbortError",
    cause: Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
  });
  ok(!isTransientLlmError(abortWithSocketCause), "an AbortError is NOT rescued by a transient-looking cause (kill switch wins)");
  const fatalWithCause = Object.assign(new Error("bad request"), { status: 400, cause: { code: "ECONNRESET" } });
  ok(!isTransientLlmError(fatalWithCause), "a 4xx is NOT rescued by a transient cause (status wins before recursion)");
}

// ── 5. routeCompletionThroughTransientRetry: a provider whose request bypasses this.caller ──
{
  let calls = 0;
  const fake = {
    completionWithRetry: async (..._args: unknown[]) => {
      calls++;
      if (calls <= 2) throw httpStatus(503);
      return "ok";
    },
  };
  const out = await routeCompletionThroughTransientRetry(fake, 4).completionWithRetry("input", false);
  ok(out === "ok" && calls === 3, "wrapped completionWithRetry retries a transient failure to success (Mistral path)");

  let calls2 = 0;
  let rejected = false;
  const fake2 = {
    completionWithRetry: async () => {
      calls2++;
      throw httpStatus(400);
    },
  };
  try {
    await routeCompletionThroughTransientRetry(fake2, 4).completionWithRetry();
  } catch {
    rejected = true;
  }
  ok(rejected && calls2 === 1, "wrapped completionWithRetry surfaces a non-transient error after one attempt");

  const noMethod = { foo: 1 };
  ok(routeCompletionThroughTransientRetry(noMethod, 4) === noMethod, "a model without completionWithRetry is returned untouched (feature-detected)");
}

console.log("\nM3 Trin 3 LLM retry/backoff classifier verified ✓");
