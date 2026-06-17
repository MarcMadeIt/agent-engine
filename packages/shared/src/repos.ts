import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface RepoInfo {
  name: string;
  path: string;
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, ".git")); // .git is a dir (normal) or a file (worktree/submodule)
    return true;
  } catch {
    return false;
  }
}

/**
 * Discover git repositories under the given base directories: each immediate
 * subdirectory that contains a `.git` (and the roots themselves if they are
 * repos). Used to let the UI pick a repo instead of typing a path.
 */
export async function discoverRepos(roots: string[]): Promise<RepoInfo[]> {
  const found: RepoInfo[] = [];
  const seen = new Set<string>();

  const add = (name: string, path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    found.push({ name, path });
  };

  for (const root of roots) {
    const abs = resolve(root);
    if (await isRepo(abs)) add(basename(abs), abs);

    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const p = join(abs, e.name);
      if (await isRepo(p)) add(e.name, p);
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}
