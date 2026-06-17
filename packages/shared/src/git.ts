import { spawn } from "node:child_process";

/**
 * The one place plumbing-level git commands run for mission infrastructure
 * (worktrees in `worktree.ts`, branch merges in `integrator.ts`). Spawns git
 * with literal args and NO shell, so nothing is interpolated. `runGit` never
 * throws (returns the exit code); `git` throws on a non-zero exit for call sites
 * that want fail-fast control flow.
 */

export const GIT_TIMEOUT_MS = 60_000;

export interface GitResult {
  code: number;
  output: string;
}

export function runGit(cwd: string, args: string[]): Promise<GitResult> {
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

export async function git(cwd: string, args: string[]): Promise<string> {
  const { code, output } = await runGit(cwd, args);
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${code}):\n${output.trim()}`);
  }
  return output;
}
