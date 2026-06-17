/**
 * End-to-end verification of the Phase 3 project graph (router + memory loop).
 * Run: pnpm --filter @arzonic/agent-api exec tsx verify-project.ts
 */
import { createProjectGraph } from "@arzonic/agent-core";
import { getModel, loadEnv, MemoryService } from "@arzonic/agent-shared";
import { Command, MemorySaver } from "@langchain/langgraph";

const env = loadEnv();
const mem = new MemoryService({
  connectionString: env.SUPABASE_DB_URL!,
  mistralApiKey: env.MISTRAL_API_KEY!,
});

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};

async function drain(s: AsyncIterable<unknown>) {
  const seen: Record<string, any>[] = [];
  for await (const u of s) seen.push(u as Record<string, any>);
  return seen;
}

await mem.setup();
const project = await mem.createProject(
  "Kaffe-webshop",
  "Mål: en lille hyggelig webshop for specialkaffe. Tone: varm, personlig, dansk. Målgruppe: kaffeentusiaster.",
);
console.log(`project: ${project.id.slice(0, 8)}`);

const graph = createProjectGraph({
  model: getModel(env),
  memory: mem,
  checkpointer: new MemorySaver(),
  guardrails: { maxRounds: 1 },
});

async function runTask(task: string, threadId: string) {
  const cfg = { configurable: { thread_id: threadId } };
  let topology = "";
  let context = "";
  for (const u of await drain(
    await graph.stream({ task, projectId: project.id, status: "running" }, { ...cfg, streamMode: "updates" }),
  )) {
    for (const [node, patch] of Object.entries(u)) {
      if (node === "router" && patch?.topology) topology = patch.topology;
      if (node === "retrieveContext") context = patch?.context ?? "";
    }
  }
  // pause at the human gate → approve
  await drain(await graph.stream(new Command({ resume: { decision: "approve" } }) as never, { ...cfg, streamMode: "updates" }));
  const final = (await graph.getState(cfg)).values as { status: string; draft: string };
  return { topology, context, status: final.status, draft: final.draft };
}

try {
  // ── Task 1 ──
  const t1 = await runTask("Skriv en kort velkomstbesked til forsiden.", "task-1");
  ok(t1.topology === "single" || t1.topology === "team", `task 1 routed → ${t1.topology}`);
  ok(t1.status === "accepted", "task 1 reached gate and was approved");
  ok(t1.draft.trim().length > 0, "task 1 produced a draft");
  console.log(`  draft 1: ${t1.draft.replace(/\s+/g, " ").slice(0, 80)}…`);

  // ── Task 2: should retrieve task 1's persisted artifact ──
  const t2 = await runTask(
    "Skriv en opfølgende besked der matcher tonen i velkomsten.",
    "task-2",
  );
  ok(t2.context.includes("(artifact)"), "task 2 retrieved a persisted artifact from memory");
  ok(t2.context.includes("Kaffe") || t2.context.includes("kaffe") || t2.context.toLowerCase().includes("webshop"), "task 2 context includes the project brief");
  console.log(`  task 2 context (first 140): ${t2.context.replace(/\s+/g, " ").slice(0, 140)}…`);

  // ── Task 3: multi-part → router should pick team (check routing only; the
  //    full team path is already verified separately, and is slow). ──
  let t3topology = "";
  for await (const u of await graph.stream(
    {
      task: "Lav en komplet markedsføringsplan: dæk SEO, sociale medier, email og betalt annoncering, hver som sit afsnit.",
      projectId: project.id,
      status: "running",
    },
    { configurable: { thread_id: "task-3" }, streamMode: "updates" },
  )) {
    for (const [node, patch] of Object.entries(u as Record<string, any>)) {
      if (node === "router" && patch?.topology) t3topology = patch.topology;
    }
    if (t3topology) break; // routing decided — stop before the heavy team run
  }
  ok(t3topology === "team", `task 3 (multi-part) routed → ${t3topology}`);

  await mem.deleteProject(project.id);
  ok(true, "cleaned up test project");
  console.log("\nProject graph verified ✓ (router + retrieve + persist + memory carries across tasks)");
} finally {
  await mem.end();
}
