/**
 * Throwaway proof for the M2 worktree-manager (build-order Trin 2): one isolated
 * worktree per item on its own branch, idempotent create (resume reuses), force
 * remove, and prune reconciling a crash. Real `git worktree` against a temp repo.
 * Run: pnpm --filter @arzonic/agent-shared exec tsx verify-worktree.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeManager } from "./src/worktree.js";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error(`FAIL: ${m}`);
  console.log(`ok: ${m}`);
};
const throws = async (fn: () => Promise<unknown>, m: string) => {
  try {
    await fn();
  } catch {
    console.log(`ok: ${m}`);
    return;
  }
  throw new Error(`FAIL: ${m} (expected to throw)`);
};
const g = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

const repo = await mkdtemp(join(tmpdir(), "verify-worktree-"));
try {
  // A repo with one commit (git worktree add needs a HEAD).
  g(repo, "init", "-q", "-b", "main");
  g(repo, "config", "user.email", "t@t.t");
  g(repo, "config", "user.name", "t");
  await writeFile(join(repo, "README.md"), "base\n");
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "init");

  const wm = createWorktreeManager(repo);

  // create provisions an isolated dir on the requested branch
  const a = await wm.create({ id: "item-a", branch: "mission/m1/item/a" });
  ok(existsSync(a.path), "create makes the worktree directory on disk");
  ok(a.branch === "mission/m1/item/a", "worktree is on the caller-supplied branch");
  ok(existsSync(join(a.path, "README.md")), "worktree has the repo contents checked out");

  // writes in one worktree don't touch the main repo or another worktree
  await writeFile(join(a.path, "only-in-a.ts"), "export const a = 1;\n");
  const b = await wm.create({ id: "item-b", branch: "mission/m1/item/b" });
  ok(!existsSync(join(b.path, "only-in-a.ts")), "worktrees are isolated from each other");
  ok(!existsSync(join(repo, "only-in-a.ts")), "worktree writes don't leak into the main repo");

  // create is idempotent — resume returns the same worktree, preserving work
  const aAgain = await wm.create({ id: "item-a", branch: "mission/m1/item/a" });
  ok(aAgain.path === a.path, "create is idempotent (resume reuses the same worktree)");
  ok((await readFile(join(aAgain.path, "only-in-a.ts"), "utf8")).includes("a = 1"), "reused worktree keeps prior work");

  // list reports only the worktrees this manager owns (not the main repo)
  const listed = await wm.list();
  ok(listed.length === 2 && listed.every((w) => w.id !== ""), "list reports the two managed worktrees, not the main repo");

  // unsafe ids are rejected before touching git/fs
  await throws(() => wm.create({ id: "../escape", branch: "x" }), "create rejects an id with a path separator");
  await throws(() => wm.create({ id: "..", branch: "x" }), "create rejects '..' as an id");

  // remove tears down the worktree; deleteBranch drops the branch too
  await wm.remove("item-a", { deleteBranch: true });
  ok(!existsSync(a.path), "remove deletes the worktree directory");
  ok((await wm.list()).length === 1, "removed worktree is gone from list");
  ok(g(repo, "rev-parse", "--verify", "--quiet", "refs/heads/mission/m1/item/a").status !== 0, "deleteBranch removed the branch");

  // prune reconciles a crash: a manually-deleted worktree dir is cleaned up
  await rm(b.path, { recursive: true, force: true });
  await wm.prune();
  ok((await wm.list()).length === 0, "prune drops the registry entry for a vanished worktree");

  // remove is a no-op when there's nothing there
  await wm.remove("never-existed");
  ok(true, "remove is a no-op for an unknown id");

  // concurrency (Trin 6): provisioning many worktrees at once must not race on
  // git's index.lock — the manager serializes git mutations internally.
  const ids = ["p0", "p1", "p2", "p3", "p4"];
  const made = await Promise.all(ids.map((id) => wm.create({ id, branch: `mission/m1/item/${id}` })));
  ok(made.length === 5 && made.every((w) => existsSync(w.path)), "5 concurrent creates all succeed (no index.lock race)");
  ok(new Set(made.map((w) => w.path)).size === 5, "each concurrent worktree got a distinct path");
  ok((await wm.list()).length === 5, "all 5 are registered");
  await Promise.all(ids.map((id) => wm.remove(id, { deleteBranch: true })));
  ok((await wm.list()).length === 0, "5 concurrent removes all succeed");

  console.log("\nM2 worktree-manager verified ✓");
} finally {
  await rm(repo, { recursive: true, force: true });
}
