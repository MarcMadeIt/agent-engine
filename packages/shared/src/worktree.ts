import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  Worktree,
  WorktreeManager,
} from "@arzonic/agent-core";

const GIT_TIMEOUT_MS = 60_000;

export interface WorktreeManagerOptions {
  /**
   * Where to place worktrees. Each lives at `<worktreesRoot>/<id>`. Defaults to
   * `<repoPath>/.agent-worktrees` (gitignore it). Kept OUT of the main working
   * tree so git doesn't see a nested checkout.
   */
  worktreesRoot?: string;
}

interface GitResult {
  code: number;
  output: string;
}

/** Spawn git with literal args and NO shell, cwd = repo. Never throws on exit code. */
function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, GIT_TIMEOUT_MS);
    const collect = (d: Buffer) => {
      output += d.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: killed ? 124 : (code ?? 1), output });
    });
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { code, output } = await runGit(cwd, args);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${code}):\n${output.trim()}`);
  }
  return output;
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

  return {
    list,

    async prune() {
      await git(repoPath, ["worktree", "prune"]);
    },

    async create({ id, branch, baseRef = "HEAD" }: CreateWorktreeOptions): Promise<Worktree> {
      assertSafeId(id);
      const path = pathFor(id);

      // Resume: a live worktree already registered for this id is reused as-is.
      const existing = (await list()).find((w) => w.id === id);
      if (existing) return existing;

      await mkdir(worktreesRoot, { recursive: true });
      // Drop stale registry entries, then clear any leftover dir from a crash so
      // `git worktree add` doesn't fail on an existing path.
      await git(repoPath, ["worktree", "prune"]);
      if (existsSync(path)) await rm(path, { recursive: true, force: true });

      const args = (await branchExists(branch))
        ? ["worktree", "add", path, branch]
        : ["worktree", "add", "-b", branch, path, baseRef];
      await git(repoPath, args);
      return { id, path, branch };
    },

    async remove(id: string, opts: RemoveWorktreeOptions = {}): Promise<void> {
      assertSafeId(id);
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
    },
  };
}
