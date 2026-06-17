/**
 * Isolated git-worktree provisioning for autonomous mission execution
 * (M2 build-order Trin 2). Pure interface — NO git, NO filesystem, NO clock here.
 * A concrete implementation (`@arzonic/agent-shared`) drives `git worktree` and
 * is injected into the controller exactly like `BacklogStore`/`Verifier`.
 *
 * Each backlog item runs in its own worktree on its own branch, so parallel
 * workers (Trin 6) never share a working tree. Branch names are supplied BY THE
 * CALLER (derived deterministically from mission/item ids) — core never invents
 * names or reads the clock, keeping it pure and resume-safe.
 */

export interface Worktree {
  /** Stable id this worktree was provisioned for (typically the backlog item id). */
  id: string;
  /** Absolute path to the worktree's working directory — the repo-tools root. */
  path: string;
  /** The git branch checked out in this worktree. */
  branch: string;
}

export interface CreateWorktreeOptions {
  /**
   * Stable, filesystem-safe id (e.g. a backlog item UUID). Keys the worktree for
   * reuse on resume and for removal. Must not contain path separators or "..".
   */
  id: string;
  /**
   * Branch to create (or check out, if it already exists) in the worktree.
   * Caller-supplied so core stays clock-free — e.g. `mission/<m>/item/<i>`.
   */
  branch: string;
  /**
   * Ref the branch is based on when first created (e.g. the mission branch or
   * "HEAD"). Ignored when the branch already exists. Defaults to "HEAD".
   */
  baseRef?: string;
}

export interface RemoveWorktreeOptions {
  /** Also delete the worktree's branch after removing the working tree. */
  deleteBranch?: boolean;
}

export interface WorktreeManager {
  /**
   * Provision (or, on resume, reuse) an isolated worktree for `id`. Idempotent:
   * calling twice for the same id returns the same worktree rather than failing.
   */
  create(opts: CreateWorktreeOptions): Promise<Worktree>;
  /** Remove the worktree for `id` (no-op if it isn't there). */
  remove(id: string, opts?: RemoveWorktreeOptions): Promise<void>;
  /** List the worktrees this manager owns. */
  list(): Promise<Worktree[]>;
  /**
   * Reconcile the git registry after a crash — drop entries whose working
   * directories no longer exist (`git worktree prune`). Safe to call anytime.
   */
  prune(): Promise<void>;
}
