"use client";

import Link from "next/link";
import type { ProjectTask } from "@arzonic/agent-client";
import { relTime, STATUS_DOT } from "../lib/format";

/** The active project's latest tasks — "Continue: …" — so the screen reads as ongoing work. */
export function RecentTasks({ tasks }: { tasks: ProjectTask[] }) {
  const recent = tasks.slice(0, 4);
  if (recent.length === 0) return null;

  return (
    <div className="rise mt-7" style={{ animationDelay: "90ms" }}>
      <p className="mb-2 text-xs uppercase tracking-[0.28em] text-dim">Seneste opgaver</p>
      <ul className="space-y-0.5">
        {recent.map((t) => (
          <li key={t.id}>
            <Link
              href={`/runs/${t.id}`}
              className="flex items-center gap-2 rounded-field px-3 py-2 transition hover:bg-elev/60"
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[t.status] ?? "bg-dim"}`} />
              <span className="min-w-0 flex-1 truncate text-sm text-fg/90">
                <span className="text-dim">Fortsæt: </span>
                {t.task}
              </span>
              {t.topology && (
                <span className="shrink-0 rounded bg-elev px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dim">
                  {t.topology === "team" ? "Team" : "Single"}
                </span>
              )}
              <span className="shrink-0 text-[11px] text-dim">{relTime(t.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
