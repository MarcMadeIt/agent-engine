import { existsSync, realpathSync, statSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type {
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  Worktree,
  WorktreeManager,
} from "@arzonic/agent-core";
import { git, runGit } from "./git.js";

export interface WorktreeManagerOptions {
  /**
   * Where to place worktrees. Each lives at `<worktreesRoot>/<id>`. Defaults to
   * `<repoPath>/.agent-worktrees` (gitignore it). Kept OUT of the main working
   * tree so git doesn't see a nested checkout.
   */
  worktreesRoot?: string;
}

/** A backlog item id becomes a directory segment — reject anything unsafe. */
function assertSafeId(id: string): void {
  if (!id || id.includes("/") || id.includes("\\") || id === "." || id === ".." || id.includes("\0")) {
    throw new Error(`Unsafe worktree id: ${JSON.stringify(id)}`);
  }
}

/**
 * `git worktree`-backed implementation of the core `WorktreeManager`
 * (M2 build-order Trin 2). Provisions one isolated worktree per backlog item on
 * its own branch, so parallel workers never share a working tree. Idempotent
 * create (reuse on resume), force-remove, and `prune` to reconcile after a crash.
 */
export function createWorktreeManager(
  repoPathArg: string,
  options: WorktreeManagerOptions = {},
): WorktreeManager {
  // Resolve symlinks (e.g. macOS /var → /private/var) so our paths match the
  // real paths `git worktree list` reports — otherwise list() never finds them.
  const repoPath = realpathSync(resolve(repoPathArg));
  const worktreesRoot = resolve(options.worktreesRoot ?? join(repoPath, ".agent-worktrees"));
  const pathFor = (id: string) => join(worktreesRoot, id);

  /**
   * Keep the worktree root out of `git status` (best-effort): when it lives
   * inside the repo, add it to `.git/info/exclude` (repo-local, never committed).
   * Skipped when the root is outside the repo or `.git` isn't a real directory.
   */
  async function ensureExcluded(): Promise<void> {
    const rel = relative(repoPath, worktreesRoot);
    if (rel === "" || rel.startsWith("..") || rel.includes(sep + "..")) return;
    try {
      const gitDir = join(repoPath, ".git");
      if (!statSync(gitDir).isDirectory()) return;
      const excludePath = join(gitDir, "info", "exclude");
      const pattern = `/${rel.split(sep).join("/")}/`;
      const current = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
      if (!current.split("\n").includes(pattern)) {
        await appendFile(excludePath, `${current.endsWith("\n") || current === "" ? "" : "\n"}${pattern}\n`);
      }
    } catch {
      // best-effort only — cosmetic git-status hygiene
    }
  }

  async function list(): Promise<Worktree[]> {
    const out = await git(repoPath, ["worktree", "list", "--porcelain"]);
    const trees: Worktree[] = [];
    let cur: { path?: string; branch?: string } = {};
    const flush = () => {
      if (cur.path && dirname(cur.path) === worktreesRoot) {
        trees.push({
          id: cur.path.slice(worktreesRoot.length + 1),
          path: cur.path,
          branch: cur.branch ?? "(detached)",
        });
      }
      cur = {};
    };
    for (const line of out.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        cur.path = resolve(line.slice("worktree ".length).trim());
      } else if (line.startsWith("branch ")) {
        cur.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      }
    }
    flush();
    return trees;
  }

  async function branchExists(branch: string): Promise<boolean> {
    const { code } = await runGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return code === 0;
  }

  // Serialize git-mutating ops: at concurrency > 1 several items provision/remove
  // worktrees at once, and concurrent `git worktree add` would race on git's
  // index.lock. The heavy work (implementer + verify) still runs in parallel;
  // only these brief git mutations queue. (list() is read-only and stays unlocked
  // so create/remove can call it while holding the lock — no re-entrant deadlock.)
  let lock: Promise<unknown> = Promise.resolve();
  const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lock.then(fn, fn);
    lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    list,

    prune() {
      return withLock(() => git(repoPath, ["worktree", "prune"]).then(() => undefined));
    },

    create({ id, branch, baseRef = "HEAD" }: CreateWorktreeOptions): Promise<Worktree> {
      assertSafeId(id);
      return withLock(async () => {
        const path = pathFor(id);

        // Resume: a live worktree already registered for this id is reused as-is.
        const existing = (await list()).find((w) => w.id === id);
        if (existing) return existing;

        await mkdir(worktreesRoot, { recursive: true });
        await ensureExcluded();
        // Drop stale registry entries, then clear any leftover dir from a crash so
        // `git worktree add` doesn't fail on an existing path.
        await git(repoPath, ["worktree", "prune"]);
        if (existsSync(path)) await rm(path, { recursive: true, force: true });

        const args = (await branchExists(branch))
          ? ["worktree", "add", path, branch]
          : ["worktree", "add", "-b", branch, path, baseRef];
        await git(repoPath, args);
        return { id, path, branch };
      });
    },

    remove(id: string, opts: RemoveWorktreeOptions = {}): Promise<void> {
      assertSafeId(id);
      return withLock(async () => {
        const existing = (await list()).find((w) => w.id === id);
        const path = pathFor(id);
        if (existing || existsSync(path)) {
          await runGit(repoPath, ["worktree", "remove", "--force", path]);
          await git(repoPath, ["worktree", "prune"]);
          if (existsSync(path)) await rm(path, { recursive: true, force: true });
        }
        if (opts.deleteBranch && existing) {
          await runGit(repoPath, ["branch", "-D", existing.branch]);
        }
      });
    },
  };
}
