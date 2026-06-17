"use client";

import type { RepoInfo } from "@arzonic/agent-client";

/** Repo selector: pick a discovered repo or type a custom path. */
export function RepoPicker({
  repos,
  value,
  onChange,
}: {
  repos: RepoInfo[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
      {repos.length > 0 && (
        <select
          value={repos.some((r) => r.path === value) ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="select select-sm w-full border-line bg-elev sm:w-44"
        >
          <option value="">Intet repo</option>
          {repos.map((r) => (
            <option key={r.path} value={r.path}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={repos.length > 0 ? "…eller en custom repo-sti" : "Repo-sti (valgfri)"}
        className="input input-sm flex-1 border-line bg-elev"
      />
    </div>
  );
}
