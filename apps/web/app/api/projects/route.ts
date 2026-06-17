import { agentFetch } from "../../lib/agent";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const res = await agentFetch("/projects");
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const res = await agentFetch("/projects", { method: "POST", body: await req.text() });
  return new Response(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
