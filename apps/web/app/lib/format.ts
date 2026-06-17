import type { RepoInfo } from "@arzonic/agent-client";

/** Dot colour per run/task status. */
export const STATUS_DOT: Record<string, string> = {
  running: "bg-builder",
  awaiting_human: "bg-warning",
  accepted: "bg-success",
  rejected: "bg-error",
  failed: "bg-error",
};

/** The standing team a project hands work to. Core runs always; the rest join on team-mode tasks. */
export const TEAM_CORE = [
  { label: "Builder", dot: "bg-builder" },
  { label: "Kritiker", dot: "bg-critic" },
];
export const TEAM_EXTRA = [
  { label: "Arkitekt", dot: "bg-lead" },
  { label: "Arbejdere", dot: "bg-analyst" },
  { label: "Lead", dot: "bg-human" },
];
export const TEAM_ALL = [...TEAM_CORE, ...TEAM_EXTRA];

/** Short, human label for a repo path — its discovered name, else the folder. */
export function repoLabel(path: string, repos: RepoInfo[]): string {
  return repos.find((r) => r.path === path)?.name ?? path.split("/").filter(Boolean).pop() ?? path;
}

/** Danish relative time, verbose ("5 min siden"). */
export function relTime(ts: string | null): string {
  if (!ts) return "aldrig";
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "lige nu";
  if (m < 60) return `${m} min siden`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} t siden`;
  return `${Math.floor(h / 24)} d siden`;
}

/** Danish relative time, compact ("5m") — for dense lists like the sidebar. */
export function relShort(ts: string): string {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return "nu";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}t`;
  return `${Math.floor(h / 24)}d`;
}
