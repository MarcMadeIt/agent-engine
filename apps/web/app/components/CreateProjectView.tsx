"use client";

import { useState } from "react";
import { LuFolderGit2 } from "react-icons/lu";
import type { RepoInfo } from "@arzonic/agent-client";
import { RepoPicker } from "./RepoPicker";

/**
 * Full-screen project-creation view — used both for the first-ever project
 * (no projects yet) and the "Nyt" flow, so it replaces the task composer
 * instead of stacking on top of it.
 */
export function CreateProjectView({
  firstEver,
  repos,
  error,
  onCreate,
  onCancel,
}: {
  firstEver: boolean;
  repos: RepoInfo[];
  error?: string | null;
  onCreate: (data: { name: string; brief: string; repoPath?: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [repo, setRepo] = useState("");

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto px-6 sm:px-8">
      <div className="w-full max-w-lg py-10">
        <div className="rise mb-6">
          <p className="mb-3 text-xs uppercase tracking-[0.35em] text-dim">
            {firstEver ? "Kom i gang" : "Nyt projekt"}
          </p>
          <h1 className="display text-4xl font-extrabold leading-[1.08] tracking-tight">
            {firstEver ? (
              <>
                Opret dit <span className="text-builder">første projekt</span>
              </>
            ) : (
              <>
                Opret et <span className="text-builder">nyt projekt</span>
              </>
            )}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-dim">
            Opgaver hører til et projekt. Teamet husker projektets mål, beslutninger og tidligere
            arbejde - så hver opgave bygger videre i stedet for at starte fra nul.
          </p>
        </div>

        <div
          className="rise space-y-2 rounded-box border border-line bg-panel p-3 shadow-2xl shadow-black/30"
          style={{ animationDelay: "60ms" }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Projektnavn (fx Ranky forside)"
            className="input input-sm w-full border-line bg-elev"
          />
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={3}
            placeholder="Brief - projektets stående mål og kontekst (teamet husker dette)"
            className="textarea textarea-sm w-full resize-none border-line bg-elev"
          />
          <div className="flex items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-dim">
              <LuFolderGit2 className="h-3.5 w-3.5" /> Repo
            </span>
            <RepoPicker repos={repos} value={repo} onChange={setRepo} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onCreate({ name, brief, repoPath: repo.trim() || undefined })}
              disabled={!name.trim()}
              className="btn btn-primary btn-sm flex-1 font-bold normal-case"
            >
              Opret projekt
            </button>
            {!firstEver && (
              <button onClick={onCancel} className="btn btn-ghost btn-sm text-dim normal-case">
                Annuller
              </button>
            )}
          </div>
        </div>

        {error && <p className="rise mt-4 text-sm text-error">{error}</p>}
      </div>
    </div>
  );
}
