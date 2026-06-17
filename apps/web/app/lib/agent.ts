/**
 * Server-side only helper for talking to the agent-engine HTTP API.
 * The bearer key lives here and NEVER reaches the browser — every browser call
 * goes through this app's /api/* route handlers, which use this.
 */
const BASE = (process.env.AGENT_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const KEY = process.env.AGENT_API_KEY ?? "";

export async function agentFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch {
    // Upstream not reachable (e.g. the API is still booting). Degrade gracefully
    // instead of throwing a 500 — callers just see a non-ok response.
    return new Response(JSON.stringify({ error: "agent api unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export { BASE as AGENT_BASE, KEY as AGENT_KEY };
