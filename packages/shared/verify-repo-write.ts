/**
 * Throwaway proof for the M2 write-layer (build-order Trin 1): the write-capable
 * RepoTools writes/edits/deletes only inside the root, and runCommand runs only
 * allowlisted executables with NO shell. Also proves the read-only factory has
 * no write methods at all — writes can't leak into a task/builder run.
 * Run: pnpm --filter @arzonic/agent-shared exec tsx verify-repo-write.ts
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoTools, createWritableRepoTools } from "./src/repoTools.js";

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

const dir = await mkdtemp(join(tmpdir(), "verify-repo-write-"));
try {
  const w = createWritableRepoTools(dir, { allowedCommands: ["node"] });

  // writeFile creates nested dirs + the file is readable back
  await w.writeFile("src/a.ts", "export const a = 1;\n");
  ok((await readFile(join(dir, "src/a.ts"), "utf8")).includes("a = 1"), "writeFile creates parent dirs and writes content");
  ok((await w.readFile("src/a.ts")).includes("a = 1"), "readFile reads written content back");

  // applyEdit: unique replace works; missing/ambiguous/no-op fail without writing
  await w.applyEdit("src/a.ts", "a = 1", "a = 2");
  ok((await readFile(join(dir, "src/a.ts"), "utf8")).includes("a = 2"), "applyEdit replaces the unique occurrence");
  await throws(() => w.applyEdit("src/a.ts", "does-not-exist", "x"), "applyEdit fails when oldString is absent");
  await w.writeFile("src/dup.ts", "x\nx\n");
  await throws(() => w.applyEdit("src/dup.ts", "x", "y"), "applyEdit refuses an ambiguous (multi-match) oldString");
  await throws(() => w.applyEdit("src/a.ts", "a = 2", "a = 2"), "applyEdit refuses a no-op (identical) edit");

  // deleteFile removes the file
  await w.deleteFile("src/dup.ts");
  await throws(() => w.readFile("src/dup.ts"), "deleteFile removes the file (readFile then fails)");

  // path sandbox applies to every mutating op
  await throws(() => w.writeFile("../escape.ts", "x"), "writeFile cannot escape the root");
  await throws(() => w.deleteFile("../../etc/hosts"), "deleteFile cannot escape the root");
  await throws(() => w.applyEdit("../x", "a", "b"), "applyEdit cannot escape the root");

  // runCommand: allowlisted executable runs; exit code is reported
  const good = await w.runCommand("node", ["-e", "process.exit(0)"]);
  ok(good.includes("exit code 0"), "runCommand runs an allowlisted executable and reports exit 0");
  const bad = await w.runCommand("node", ["-e", "process.exit(3)"]);
  ok(bad.includes("exit code 3"), "runCommand reports a non-zero exit code");

  // runCommand: non-allowlisted is refused WITHOUT spawning
  const denied = await w.runCommand("rm", ["-rf", "/"]);
  ok(denied.includes("not allowed"), "runCommand refuses a non-allowlisted executable");
  const pathy = await w.runCommand("../bin/node", ["-e", ""]);
  ok(pathy.includes("not allowed"), "runCommand refuses a command containing a path separator");

  // runCommand has no shell: metacharacters are inert literal args, not interpreted
  const noShell = await w.runCommand("node", ["-e", "console.log('safe && echo pwned')"]);
  ok(noShell.includes("safe && echo pwned") && !noShell.includes("pwned\n"), "runCommand passes args verbatim — no shell interpolation");

  // read-only factory has NO write methods — writes can't leak into a task run
  const ro = createRepoTools(dir) as Record<string, unknown>;
  ok(typeof ro.writeFile === "undefined", "createRepoTools exposes no writeFile");
  ok(typeof ro.applyEdit === "undefined", "createRepoTools exposes no applyEdit");
  ok(typeof ro.deleteFile === "undefined", "createRepoTools exposes no deleteFile");
  ok(typeof ro.runCommand === "undefined", "createRepoTools exposes no runCommand");

  console.log("\nM2 write-layer verified ✓");
} finally {
  await rm(dir, { recursive: true, force: true });
}
