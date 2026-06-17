"use client";

import { LuUsers } from "react-icons/lu";
import { TEAM_CORE, TEAM_EXTRA } from "../lib/format";

/** Display-only roster: core agents at full weight, team-mode agents dimmed. */
export function TeamRoster() {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-dim">
        <LuUsers className="h-3.5 w-3.5" /> Team
      </span>
      {TEAM_CORE.map((r) => (
        <span
          key={r.label}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-elev px-2 py-0.5 text-[11px] text-fg/80"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
          {r.label}
        </span>
      ))}
      {TEAM_EXTRA.map((r) => (
        <span
          key={r.label}
          title="Tilføjes ved team-opgaver"
          className="inline-flex items-center gap-1 rounded-full border border-line bg-elev px-2 py-0.5 text-[11px] text-dim opacity-60"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${r.dot}`} />
          {r.label}
        </span>
      ))}
    </span>
  );
}
