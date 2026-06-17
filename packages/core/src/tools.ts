/**
 * Tool contract for agents that work on a repo. Pure interface — NO I/O here.
 * The runtime (apps/cli, apps/api) supplies a concrete, sandboxed implementation
 * and injects it into the graph. This keeps `core` portable (Ranky can provide
 * its own implementation) while letting agents gain real capabilities.
 *
 * Layer 1 (read-only): list, read, search.
 * Layer 2 adds runCheck — running an allowlisted verification command (tests,
 * lint, typecheck, build). Still no writes and no arbitrary commands; the
 * runtime enforces the allowlist.
 */
export interface RepoTools {
  /** List entries in a directory relative to the repo root (dirs end with "/"). */
  listFiles(dir: string): Promise<string>;
  /** Read a UTF-8 file relative to the repo root (implementations may truncate). */
  readFile(path: string): Promise<string>;
  /** Case-insensitive substring search across the repo; returns `path:line: text` hits. */
  searchCode(query: string): Promise<string>;
  /**
   * Run an allowlisted verification check (e.g. "test", "lint", "typecheck",
   * "build") in the repo and return its output + exit status. The runtime
   * rejects any name not on its allowlist — there is no arbitrary execution.
   */
  runCheck(name: string): Promise<string>;
}
