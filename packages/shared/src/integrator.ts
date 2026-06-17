import type { Integrator, MergeResult, WorktreeManager } from "@arzonic/agent-core";
import { git, runGit } from "./git.js";

export interface GitIntegratorOptions {
  /** The mission's integration branch (e.g. `mission/<id>`); item branches merge into it. */
  missionBranch: string;
  /** Removes the item's worktree after a successful integration (Trin 2 manager). */
  worktrees?: WorktreeManager;
  /** Delete the item branch after merging it. Default true (merged work lives on the mission branch). */
  deleteMergedBranch?: boolean;
}

/**
 * Ensure `branch` exists in `repoPath` and is checked out. Creates it from
 * `baseRef` (default: current HEAD) when missing. Call once before a mission runs
 * so item worktrees can base off the mission branch and merges have a target.
 */
export async function ensureGitBranch(
  repoPath: string,
  branch: string,
  baseRef?: string,
): Promise<void> {
  const exists = (await runGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
  if (exists) {
    await git(repoPath, ["checkout", branch]);
  } else {
    await git(repoPath, ["checkout", "-b", branch, ...(baseRef ? [baseRef] : [])]);
  }
}

/**
 * git-backed `Integrator` (M2 build-order Trin 5). Merges a worktree-green item's
 * branch into the mission branch in the main repo working tree (so the controller
 * can re-verify there via the Verifier), with `rollback` to undo a red post-merge
 * build and `cleanup` to drop the merged item's worktree. Pure git plumbing — the
 * pass/fail truth stays with the Verifier. Serial by contract: the controller
 * calls merge → (verify) → rollback/cleanup for one item before the next.
 */
export function createGitIntegrator(
  repoPath: string,
  options: GitIntegratorOptions,
): Integrator {
  const { missionBranch, worktrees } = options;
  const deleteMergedBranch = options.deleteMergedBranch ?? true;
  /** SHA of the mission branch before the in-flight merge, for rollback. */
  let preMergeSha: string | null = null;

  return {
    async merge({ branch, worktree }): Promise<MergeResult> {
      // The implementer leaves changes UNCOMMITTED in its worktree. Commit them
      // onto the item branch first, so the merge actually carries the new code.
      // Explicit identity avoids "tell me who you are" on un-configured repos.
      if (worktree) {
        await git(worktree, ["add", "-A"]);
        const dirty = (await git(worktree, ["status", "--porcelain"])).trim();
        if (dirty) {
          await git(worktree, [
            "-c", "user.email=mission@agent-engine.local",
            "-c", "user.name=Agent Mission",
            "commit", "-m", `mission: ${branch}`,
          ]);
        }
      }
      await git(repoPath, ["checkout", missionBranch]);
      preMergeSha = (await git(repoPath, ["rev-parse", "HEAD"])).trim();
      const res = await runGit(repoPath, ["merge", "--no-ff", "--no-edit", branch]);
      if (res.code !== 0) {
        // Conflict (or other merge failure): abort so the branch stays clean.
        await runGit(repoPath, ["merge", "--abort"]);
        preMergeSha = null;
        return { merged: false, output: res.output.trim() };
      }
      return { merged: true, output: res.output.trim() };
    },

    async rollback(): Promise<void> {
      if (!preMergeSha) return;
      await git(repoPath, ["reset", "--hard", preMergeSha]);
      preMergeSha = null;
    },

    async cleanup(itemId): Promise<void> {
      preMergeSha = null;
      if (worktrees) await worktrees.remove(itemId, { deleteBranch: deleteMergedBranch });
    },
  };
}
