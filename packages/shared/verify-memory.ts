/**
 * Throwaway verification of the pgvector MemoryService round-trip.
 * Run: pnpm --filter @arzonic/agent-shared exec tsx verify-memory.ts
 */
import { loadEnv } from "./src/env.js";
import { MemoryService } from "./src/memory.js";

const env = loadEnv();
if (!env.SUPABASE_DB_URL || !env.MISTRAL_API_KEY) {
  console.error("Need SUPABASE_DB_URL + MISTRAL_API_KEY in .env");
  process.exit(1);
}

const mem = new MemoryService({
  connectionString: env.SUPABASE_DB_URL,
  mistralApiKey: env.MISTRAL_API_KEY,
});

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};

try {
  await mem.setup();
  ok(true, "setup ran (extension + tables + index)");

  const project = await mem.createProject(
    "Ranky launch",
    "Project goal: relaunch the Ranky front page for higher conversion. Audience: Danish consumers.",
  );
  ok(!!project.id, `created project ${project.name} (${project.id.slice(0, 8)})`);

  await mem.store(project.id, "decision", "Beslutning: lanceringsdatoen er 15. marts 2026.");
  await mem.store(project.id, "artifact", "Hero-overskriften blev: 'Find de bedst rangerede sider i Danmark'.");
  await mem.store(project.id, "note", "Farvepaletten bruger en mørk baggrund med lime accent.");
  ok(true, "stored 3 memories (embedded into pgvector)");

  const ctx = await mem.retrieve(project.id, "Hvornår lancerer vi, og hvad er datoen?");
  ok(ctx.brief.includes("Ranky"), "retrieve always includes the project brief");
  ok(ctx.hits.length > 0, `retrieve returned ${ctx.hits.length} hits`);
  const top = ctx.hits[0]!;
  ok(
    top.content.includes("15. marts"),
    `top hit is the launch-date decision (score ${top.score.toFixed(3)}): "${top.content.slice(0, 50)}…"`,
  );

  console.log("\nTop hits:");
  for (const h of ctx.hits) console.log(`  [${h.kind}] ${h.score.toFixed(3)} — ${h.content.slice(0, 60)}`);

  // clean up the test project
  await mem.deleteProject(project.id);
  ok(true, "cleaned up test project");

  console.log("\nMemoryService round-trip verified ✓");
} finally {
  await mem.end();
}
