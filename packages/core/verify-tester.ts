/**
 * Throwaway proof for M3 Trin 2 — the TestAuthor seam ("green = strong truth"):
 * after the implementer builds an item, a test that EXERCISES the new code is
 * authored in the worktree before the Verifier runs, so a green build is real
 * evidence — not just "it compiles". No API key, no DB.
 *
 * Proves:
 *  1. The real `makeTestAuthor` (scripted fake tool-calling model) authors a test
 *     on disk that is RED on a buggy implementation and GREEN once it's fixed —
 *     exit code, not an LLM score, is the truth. Tokens are summed.
 *  2. The controller calls the TestAuthor AFTER the runner and BEFORE the Verifier,
 *     in the item's worktree, and folds its tokens into the mission budget.
 *  3. With no worktree (the read-only planning runner) the seam is skipped.
 *  4. With no TestAuthor injected the loop behaves exactly as before (no crash).
 * Run: pnpm --filter @arzonic/agent-core exec tsx verify-tester.ts
 */
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWritableRepoTools } from "../shared/src/repoTools.js";
import {
  runMission,
  type MissionDeps,
  type TestAuthor,
} from "./src/controller.js";
import { isTestPath, makeTestAuthor } from "./src/nodes/testAuthor.js";
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
const usage = { input_tokens: 5, output_tokens: 5, total_tokens: 10 };

/** A BaseChatModel that replays a fixed list of AI messages — one per turn. */
class ScriptedToolModel extends BaseChatModel {
  private i = 0;
  constructor(private readonly steps: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "scripted-tool";
  }
  override bindTools() {
    return this;
  }
  async _generate(_messages: unknown) {
    const msg = this.steps[Math.min(this.i, this.steps.length - 1)]!;
    this.i += 1;
    const text = typeof msg.content === "string" ? msg.content : "";
    return { generations: [{ text, message: msg }] };
  }
}

function initGitRepo(dir: string) {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
  git("init", "-q");
  git("config", "user.email", "t@t.dev");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  execFileSync("node", ["-e", "require('fs').writeFileSync('README.md','base\\n')"], { cwd: dir });
  git("add", "-A");
  git("commit", "-qm", "base");
}

const baseMission: Mission = {
  id: "m1",
  projectId: "p1",
  goal: "Tilføj en add-funktion",
  acceptanceCriteria: ["add(a,b) returnerer summen"],
  repoPath: "/tmp/repo",
  status: "running",
  budget: null,
  spentTokens: 0,
  deadline: null,
  createdAt: iso(),
};

const baseItem = (over: Partial<BacklogItem> = {}): BacklogItem => ({
  id: "i1",
  missionId: "m1",
  title: "Implementér add(a, b)",
  detail: "En ren funktion der lægger to tal sammen.",
  status: "in_progress",
  priority: 1,
  dependsOn: [],
  risk: "low",
  runId: null,
  verification: null,
  createdAt: iso(),
  updatedAt: iso(),
  ...over,
});

const baseResult = (over: Partial<WorkResult> = {}): WorkResult => ({
  runId: "r1",
  status: "accepted",
  draft: "Skrev add.js (a - b).",
  verdict: null,
  tokensUsed: 0,
  ...over,
});

// The test the (scripted) tester authors: a plain-node assertion that genuinely
// calls add(). It is the SAME file in both the red and green runs.
const TEST_SRC = [
  'const assert = require("node:assert");',
  'const { add } = require("./add.js");',
  'assert.strictEqual(add(2, 3), 5, "add(2,3) skal give 5");',
  'console.log("ok");',
  "",
].join("\n");

// ── 1. real makeTestAuthor: authored test is RED on a buggy impl, GREEN once fixed ──
{
  const dir = await mkdtemp(join(tmpdir(), "verify-tester-"));
  try {
    initGitRepo(dir);
    // The implementer's (buggy) output: subtraction instead of addition.
    writeFileSync(join(dir, "add.js"), "module.exports.add = (a, b) => a - b;\n");

    const repoFactory = (wt: string) =>
      createWritableRepoTools(wt, { allowedCommands: ["git", "node"] });
    const model = new ScriptedToolModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "write_file", args: { path: "add.test.js", content: TEST_SRC }, id: "t1", type: "tool_call" },
        ],
        usage_metadata: usage,
      }),
      new AIMessage({ content: "Tilføjede add.test.js der tjekker add(2,3) === 5.", usage_metadata: usage }),
    ]);

    const testAuthor = makeTestAuthor(model as unknown as BaseChatModel, { repo: repoFactory });
    const res = await testAuthor.authorTest({
      mission: baseMission,
      item: baseItem(),
      result: baseResult({ worktree: dir, branch: "b1" }),
    });

    ok(existsSync(join(dir, "add.test.js")), "the tester wrote a test file into the worktree");
    ok(res.authored === true, "authorTest reports it authored a test");
    ok(res.tokensUsed === 20, "tester tokens summed across model turns (2×10)");

    // The authored test is a REAL check: run it with node, exit code is the truth.
    const runNodeTest = (cwd: string): VerifierReport => {
      try {
        execFileSync("node", ["add.test.js"], { cwd, stdio: "pipe" });
        return { passed: true, results: [{ passed: true, check: "test", output: "" }] };
      } catch (e) {
        return { passed: false, results: [{ passed: false, check: "test", output: String(e) }] };
      }
    };

    ok(runNodeTest(dir).passed === false, "the authored test FAILS the buggy implementation (red — exit code, not an LLM, decides)");

    // Simulate the implementer fixing the bug; the SAME authored test now passes.
    writeFileSync(join(dir, "add.js"), "module.exports.add = (a, b) => a + b;\n");
    ok(runNodeTest(dir).passed === true, "the same authored test PASSES once the implementation is correct (green)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// In-memory backlog store (one mission, a map of items), copied from verify-decompose.
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

const seededItem = (): BacklogItem => ({
  id: "seed-1",
  missionId: "m1",
  title: "seeded",
  detail: "",
  status: "todo",
  priority: 1,
  dependsOn: [],
  risk: "low",
  runId: null,
  verification: null,
  createdAt: iso(),
  updatedAt: iso(),
});

// ── 2. the controller authors the test BEFORE verifying, in the worktree, and folds tokens ──
{
  const wt = await mkdtemp(join(tmpdir(), "verify-tester-ctrl-"));
  try {
    const store = makeStore({ ...baseMission, spentTokens: 0 }, [seededItem()]);
    const runner: WorkRunner = {
      async run(it) {
        return baseResult({ runId: it.id, draft: `built ${it.id}`, tokensUsed: 100, worktree: wt, branch: "b1" });
      },
    };
    // The verifier passes ONLY if the marker file exists in the cwd it was handed —
    // so a green result proves the author ran first, in the right worktree.
    const verifier: Verifier = {
      async run(checks, cwd): Promise<VerifierReport> {
        const passed = !!cwd && existsSync(join(cwd, "authored.marker"));
        return { passed, results: checks.map((c) => ({ passed, check: c, output: "" })) };
      },
    };
    let calls = 0;
    let sawWorktree: string | undefined;
    const testAuthor: TestAuthor = {
      async authorTest({ result }) {
        calls++;
        sawWorktree = result.worktree;
        writeFileSync(join(result.worktree!, "authored.marker"), "test\n");
        return { authored: true, tokensUsed: 33 };
      },
    };
    const deps: MissionDeps = { backlog: store, verifier, runner, testAuthor };
    const out = await runMission(deps, "m1");

    ok(out.status === "done" && out.itemsDone === 1, "the item is done — verify passed, which it only does if the test was authored FIRST");
    ok(calls === 1 && sawWorktree === wt, "the TestAuthor was called once, in the item's worktree");
    ok((await store.getMission("m1"))!.spentTokens === 133, "tester tokens (33) fold into the budget alongside the work (100)");
  } finally {
    await rm(wt, { recursive: true, force: true });
  }
}

// ── 3. no worktree (planning runner) ⇒ the seam is skipped, not crashed ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, [seededItem()]);
  const runner: WorkRunner = {
    async run(it) {
      return baseResult({ runId: it.id, tokensUsed: 10 }); // no worktree
    },
  };
  const passing: Verifier = {
    async run(checks): Promise<VerifierReport> {
      return { passed: true, results: checks.map((c) => ({ passed: true, check: c, output: "" })) };
    },
  };
  let calls = 0;
  const testAuthor: TestAuthor = {
    async authorTest() {
      calls++;
      return { authored: false };
    },
  };
  const out = await runMission({ backlog: store, verifier: passing, runner, testAuthor }, "m1");
  ok(calls === 0, "with no worktree the TestAuthor is never called (planning runner safe)");
  ok(out.status === "done" && out.itemsDone === 1, "the item still completes normally");
}

// ── 4. backward-compat: no TestAuthor injected ⇒ unchanged behaviour ──
{
  const store = makeStore({ ...baseMission, spentTokens: 0 }, [seededItem()]);
  const runner: WorkRunner = {
    async run(it) {
      return baseResult({ runId: it.id, tokensUsed: 100, worktree: "/tmp/whatever" });
    },
  };
  const passing: Verifier = {
    async run(checks): Promise<VerifierReport> {
      return { passed: true, results: checks.map((c) => ({ passed: true, check: c, output: "" })) };
    },
  };
  const out = await runMission({ backlog: store, verifier: passing, runner }, "m1");
  ok(out.status === "done" && out.itemsDone === 1, "without a TestAuthor the loop behaves exactly as before");
  ok((await store.getMission("m1"))!.spentTokens === 100, "no extra tokens spent when the seam is omitted");
}

// ── 5. the tester may ONLY write test files — an impl-source write is rejected ──
{
  ok(
    isTestPath("add.test.js") &&
      isTestPath("src/__tests__/x.ts") &&
      isTestPath("tests/a.spec.ts") &&
      isTestPath("pkg/foo_test.go"),
    "test-path conventions are recognised (*.test.*, __tests__/, tests/*.spec.*, _test.)",
  );
  ok(!isTestPath("src/add.js") && !isTestPath("src/contest.ts"), "implementation source is NOT a test path");

  const dir = await mkdtemp(join(tmpdir(), "verify-tester-guard-"));
  try {
    initGitRepo(dir);
    writeFileSync(join(dir, "add.js"), "module.exports.add = (a, b) => a + b;\n"); // correct impl
    // A tester that tries to "fix" the impl so its own test passes — forbidden.
    const model = new ScriptedToolModel([
      new AIMessage({
        content: "",
        tool_calls: [
          { name: "write_file", args: { path: "add.js", content: "module.exports.add = () => 999;\n" }, id: "g1", type: "tool_call" },
        ],
        usage_metadata: usage,
      }),
      new AIMessage({ content: "(forsøgte at ændre add.js)", usage_metadata: usage }),
    ]);
    const testAuthor = makeTestAuthor(model as unknown as BaseChatModel, {
      repo: (wt) => createWritableRepoTools(wt, { allowedCommands: ["git", "node"] }),
    });
    const res = await testAuthor.authorTest({ mission: baseMission, item: baseItem(), result: baseResult({ worktree: dir }) });

    ok(readFileSync(join(dir, "add.js"), "utf8").includes("a + b"), "the impl-source write was REJECTED — add.js is untouched (capability, not prompt)");
    ok(res.authored === false, "a rejected (errored) write is not counted as authored");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.log("\nM3 Trin 2 test author (green = strong truth) verified ✓");
