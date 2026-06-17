/**
 * Throwaway proof for the M2 git integrator (build-order Trin 5): commits the
 * implementer's uncommitted worktree changes onto the item branch and merges it
 * into the mission branch; aborts cleanly on conflict; rollback undoes a merge;
 * cleanup removes the item worktree. Real git against a temp repo.
 * Run: pnpm --filter @arzonic/agent-shared exec tsx verify-integrator.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitIntegrator, ensureGitBranch } from "./src/integrator.js";
import { createWorktreeManager } from "./src/worktree.js";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};
const g = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });
const head = (cwd: string) => g(cwd, "rev-parse", "HEAD").stdout.trim();
const porcelain = (cwd: string) => g(cwd, "status", "--porcelain", "-uno").stdout.trim();

const repo = await mkdtemp(join(tmpdir(), "verify-integrator-"));
try {
  g(repo, "init", "-q", "-b", "main");
  g(repo, "config", "user.email", "t@t.t");
  g(repo, "config", "user.name", "t");
  await writeFile(join(repo, "shared.txt"), "base\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");

  await ensureGitBranch(repo, "mission/m/integration");
  ok(g(repo, "rev-parse", "--abbrev-ref", "HEAD").stdout.trim() === "mission/m/integration", "ensureGitBranch creates + checks out the mission branch");

  const worktrees = createWorktreeManager(repo);
  const integrator = createGitIntegrator(repo, { missionBranch: "mission/m/integration", worktrees });

  // ── happy merge: authored (uncommitted) code flows into the mission branch ──
  const a = await worktrees.create({ id: "a", branch: "mission/m/item/a", baseRef: "mission/m/integration" });
  await writeFile(join(a.path, "feature-a.ts"), "export const a = 1;\n");
  const m1 = await integrator.merge({ itemId: "a", branch: a.branch, worktree: a.path });
  ok(m1.merged, "merge of a green item succeeds");
  ok(existsSync(join(repo, "feature-a.ts")), "authored code is now on the mission branch in the main repo");
  await integrator.cleanup("a");
  ok(!existsSync(a.path), "cleanup removes the merged item's worktree");
  ok((await worktrees.list()).every((w) => w.id !== "a"), "merged worktree is gone from the registry");

  // ── conflict: a competing change on the mission branch makes the merge abort ──
  const b = await worktrees.create({ id: "b", branch: "mission/m/item/b", baseRef: "mission/m/integration" });
  await writeFile(join(b.path, "shared.txt"), "from-b\n"); // edits the shared file
  // Meanwhile the mission branch advances with a conflicting edit to the same file.
  g(repo, "checkout", "-q", "mission/m/integration");
  await writeFile(join(repo, "shared.txt"), "from-main\n");
  g(repo, "commit", "-q", "-am", "diverge on shared.txt");
  const headBeforeConflict = head(repo);
  const m2 = await integrator.merge({ itemId: "b", branch: b.branch, worktree: b.path });
  ok(!m2.merged, "a conflicting merge reports merged=false");
  // -uno: ignore the (excluded) worktree dir; assert no tracked file is left dirty/conflicted.
  ok(porcelain(repo) === "", "the merge was aborted — no tracked conflict markers remain");
  ok(g(repo, "show", "HEAD:shared.txt").stdout === "from-main\n", "the conflicted file is restored to the mission-branch version");
  ok(head(repo) === headBeforeConflict, "mission branch HEAD is unchanged after the aborted merge");

  // ── rollback: undo a merge whose post-merge build would be red ──
  const c = await worktrees.create({ id: "c", branch: "mission/m/item/c", baseRef: "mission/m/integration" });
  await writeFile(join(c.path, "feature-c.ts"), "export const c = 1;\n");
  const headBeforeC = head(repo);
  const m3 = await integrator.merge({ itemId: "c", branch: c.branch, worktree: c.path });
  ok(m3.merged && existsSync(join(repo, "feature-c.ts")), "merge of c lands the file on the mission branch");
  ok(head(repo) !== headBeforeC, "mission branch advanced past the merge");
  await integrator.rollback();
  ok(head(repo) === headBeforeC, "rollback restores the pre-merge HEAD");
  ok(!existsSync(join(repo, "feature-c.ts")), "rollback removes the merged file — mission branch kept green");

  console.log("\nM2 git integrator verified ✓");
} finally {
  await rm(repo, { recursive: true, force: true });
}
