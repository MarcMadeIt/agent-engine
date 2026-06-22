/**
 * Throwaway proof for M3 Trin 3 controller-level drift-robustness: an item whose
 * run throws a TRANSIENT/infra error is re-queued (not parked as a logic failure)
 * and still completes; a NON-transient throw is surfaced (parked for a human),
 * never swallowed and never crashing the batch; a persistent outage still
 * TERMINATES (via requeueLimit or no-progress). Uses the REAL shared
 * `isTransientLlmError` as the injected predicate. In-memory fakes, no DB/LLM.
 * Run: pnpm --filter @arzonic/agent-core exec tsx verify-drift.ts
 */
import { isTransientLlmError } from "../shared/src/retry.js";
import {
  runMission,
  type MissionDeps,
  type MissionEvent,
} from "./src/controller.js";
import type {
  BacklogItem,
  BacklogStore,
  CreateBacklogItemInput,
  Mission,
} from "./src/mission.js";
import type { WorkResult, WorkRunner } from "./src/runner.js";
import type { Verifier, VerifierReport } from "./src/verifier.js";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};

let seq = 0;
const iso = () => new Date(1_700_000_000_000 + seq++ * 1000).toISOString();
const transientErr = () => Object.assign(new Error("overloaded"), { status: 503 });
const fatalErr = () => Object.assign(new Error("bad request"), { status: 400 });

function makeStore(mission: Mission, items: BacklogItem[]): BacklogStore {
  const missions = new Map([[mission.id, { ...mission }]]);
  const map = new Map(items.map((i) => [i.id, { ...i }]));
  return {
    async createMission() {
      throw new Error("unused");
    },
    async getMission(id) {
      const m = missions.get(id);
      return m ? { ...m } : null;
    },
    async listMissions() {
      return [...missions.values()];
    },
    async updateMission(id, patch) {
      const m = missions.get(id);
      if (!m) return null;
      Object.assign(m, patch);
      return { ...m };
    },
    async deleteMission(id) {
      missions.delete(id);
    },
    async createItem(input: CreateBacklogItemInput) {
      const it: BacklogItem = {
        id: `gen-${seq++}`,
        missionId: input.missionId,
        title: input.title,
        detail: input.detail ?? "",
        status: "todo",
        priority: input.priority ?? 0,
        dependsOn: input.dependsOn ?? [],
        risk: input.risk ?? "low",
        runId: null,
        verification: null,
        createdAt: iso(),
        updatedAt: iso(),
      };
      map.set(it.id, it);
      return { ...it };
    },
    async getItem(id) {
      const i = map.get(id);
      return i ? { ...i } : null;
    },
    async listItems() {
      return [...map.values()].sort(
        (a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
      );
    },
    async updateItem(id, patch) {
      const i = map.get(id);
      if (!i) return null;
      Object.assign(i, patch, { updatedAt: iso() });
      return { ...i };
    },
    async nextActionable(missionId) {
      const candidates = [...map.values()]
        .filter((i) => i.missionId === missionId && i.status === "todo")
        .filter((i) => i.dependsOn.every((d) => map.get(d)?.status === "done"))
        .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
      return candidates[0] ? { ...candidates[0]! } : null;
    },
  };
}

const baseMission: Mission = {
  id: "m1",
  projectId: "p1",
  goal: "Build the thing",
  acceptanceCriteria: ["builds"],
  repoPath: "/tmp/repo",
  status: "running",
  budget: null,
  spentTokens: 0,
  deadline: null,
  createdAt: iso(),
};

const oneItem = (): BacklogItem[] => [
  {
    id: "i1",
    missionId: "m1",
    title: "do the work",
    detail: "",
    status: "todo",
    priority: 1,
    dependsOn: [],
    risk: "low",
    runId: null,
    verification: null,
    createdAt: iso(),
    updatedAt: iso(),
  },
];

const passingVerifier: Verifier = {
  async run(checks): Promise<VerifierReport> {
    return { passed: true, results: checks.map((c) => ({ passed: true, check: c, output: "" })) };
  },
};

const recorder = () => {
  const events: MissionEvent[] = [];
  return { events, notifier: { notify: (e: MissionEvent) => void events.push(e) } };
};

const okResult = (id: string): WorkResult => ({
  runId: id,
  status: "accepted",
  draft: `built ${id}`,
  verdict: null,
  tokensUsed: 100,
});

// ── 1. a transient run failure is re-queued and the item still completes ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  let calls = 0;
  const runner: WorkRunner = {
    async run(it) {
      calls++;
      if (calls <= 2) throw transientErr(); // two transient blips, then success
      return okResult(it.id);
    },
  };
  const { events, notifier } = recorder();
  const deps: MissionDeps = {
    backlog: store,
    verifier: passingVerifier,
    runner,
    notifier,
    isTransientError: isTransientLlmError,
    governors: { noProgressLimit: 5 },
  };
  const out = await runMission(deps, "m1");
  const item = (await store.listItems("m1"))[0]!;
  const retries = events.filter((e) => e.type === "item_retried");
  ok(out.status === "done" && out.itemsDone === 1, "the item completes despite two transient failures");
  ok(calls === 3, "the runner was retried until it succeeded (3 calls)");
  ok(retries.length === 2, "two item_retried events were emitted (the structured retry log)");
  ok(item.status === "done", "the item is done — a transient blip never parked it as a logic failure");
}

// ── 2. a NON-transient throw is surfaced (parked for a human), never swallowed ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  let calls = 0;
  const runner: WorkRunner = {
    async run() {
      calls++;
      throw fatalErr(); // a 400 — not transient
    },
  };
  const { events, notifier } = recorder();
  const out = await runMission(
    { backlog: store, verifier: passingVerifier, runner, notifier, isTransientError: isTransientLlmError },
    "m1",
  );
  const item = (await store.listItems("m1"))[0]!;
  ok(calls === 1, "a non-transient error is NOT retried (run called once)");
  ok(item.status === "blocked_needs_human", "the crashed item is parked for a human, not silently failed");
  ok(item.verification?.check === "run-error" && (item.verification?.output ?? "").includes("bad request"), "the real error is recorded on the item (surfaced, not hidden)");
  ok(events.every((e) => e.type !== "item_retried"), "a non-transient error is never treated as a retry");
  ok(out.status === "blocked", "the mission ends blocked (a crash needs attention), not a misleading done");
}

// ── 3. a persistent transient outage terminates via requeueLimit (park) ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  const runner: WorkRunner = {
    async run() {
      throw transientErr(); // never recovers
    },
  };
  const { events, notifier } = recorder();
  const out = await runMission(
    {
      backlog: store,
      verifier: passingVerifier,
      runner,
      notifier,
      isTransientError: isTransientLlmError,
      governors: { requeueLimit: 2, noProgressLimit: 10 },
    },
    "m1",
  );
  const item = (await store.listItems("m1"))[0]!;
  const retries = events.filter((e) => e.type === "item_retried");
  ok(retries.length === 2, "re-queued exactly requeueLimit (2) times before giving up");
  ok(item.status === "blocked_needs_human" && item.verification?.check === "infrastructure", "a persistent outage parks the item as an infrastructure failure (distinct from a logic failure)");
  ok(out.status === "blocked", "the mission terminates (blocked) — no infinite loop");
}

// ── 4. a persistent transient outage also terminates via no-progress ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  const runner: WorkRunner = {
    async run() {
      throw transientErr();
    },
  };
  const out = await runMission(
    {
      backlog: store,
      verifier: passingVerifier,
      runner,
      isTransientError: isTransientLlmError,
      governors: { noProgressLimit: 2, requeueLimit: 10 },
    },
    "m1",
  );
  ok(out.status === "stopped" && out.reason === "no-progress", "re-queues count as no-progress, so a long outage trips the no-progress governor");
}

// ── 5. backward-compat: no isTransientError seam ──
{
  // a passing runner behaves exactly as before
  const store = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  const runner: WorkRunner = { async run(it) { return okResult(it.id); } };
  const out = await runMission({ backlog: store, verifier: passingVerifier, runner }, "m1");
  ok(out.status === "done" && out.itemsDone === 1, "without the seam a normal mission still completes");

  // a throwing runner is contained (parked), not a crash that aborts the batch
  const store2 = makeStore({ ...baseMission, spentTokens: 0 }, oneItem());
  const throwing: WorkRunner = { async run() { throw transientErr(); } };
  const out2 = await runMission({ backlog: store2, verifier: passingVerifier, runner: throwing }, "m1");
  const item2 = (await store2.listItems("m1"))[0]!;
  ok(out2.status === "blocked" && item2.status === "blocked_needs_human", "with no predicate a thrown error is treated as non-transient — parked, not crashing the mission");
}

console.log("\nM3 Trin 3 drift-robustness (controller recovery) verified ✓");
