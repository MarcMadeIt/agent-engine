"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LuBrain, LuFolderPlus } from "react-icons/lu";
import type { Project, ProjectTask, RepoInfo, Rubric } from "@arzonic/agent-client";
import {
  ACTIVE_PROJECT_EVENT,
  consumeNewProjectRequest,
  getActiveProject,
  NEW_PROJECT_EVENT,
  useActiveProject,
} from "./lib/activeProject";
import { relTime, repoLabel } from "./lib/format";
import { CreateProjectView } from "./components/CreateProjectView";
import { DefinitionOfDone } from "./components/DefinitionOfDone";
import { RecentTasks } from "./components/RecentTasks";
import { RepoMenu } from "./components/RepoMenu";
import { TeamRoster } from "./components/TeamRoster";

export default function Composer() {
  const router = useRouter();
  const [task, setTask] = useState("");
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useActiveProject();
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [savingRepo, setSavingRepo] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => projects.find((p) => p.id === projectId) ?? null,
    [projects, projectId],
  );

  // Initial load: projects (with stats, most-recently-used first), repos, rubric.
  useEffect(() => {
    void (async () => {
      try {
        const [p, r, rb] = await Promise.all([
          fetch("/api/projects"),
          fetch("/api/repos"),
          fetch("/api/rubric"),
        ]);
        if (p.ok) {
          const list = ((await p.json()) as Project[]).filter((x) => x.name !== "Scratch");
          setProjects(list);
          const cur = getActiveProject();
          if ((!cur || !list.some((x) => x.id === cur)) && list[0]) setProjectId(list[0].id);
        }
        if (r.ok) setRepos((await r.json()) as RepoInfo[]);
        if (rb.ok) setRubric((await rb.json()) as Rubric);
      } catch {
        /* API still booting — the empty state handles it */
      } finally {
        setLoaded(true);
      }
    })();
  }, [setProjectId]);

  // Recent tasks for the active project.
  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks`);
        if (res.ok && alive) setTasks((await res.json()) as ProjectTask[]);
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => {
    if (loaded) taRef.current?.focus();
  }, [loaded]);

  // Open the "new project" view when the rail's "Nyt projekt" asks for it.
  useEffect(() => {
    if (consumeNewProjectRequest()) setNewOpen(true);
    const onReq = () => setNewOpen(true);
    window.addEventListener(NEW_PROJECT_EVENT, onReq);
    return () => window.removeEventListener(NEW_PROJECT_EVENT, onReq);
  }, []);

  // Picking a project (rail or dropdown) closes the "new project" view.
  useEffect(() => {
    const onSwitch = () => setNewOpen(false);
    window.addEventListener(ACTIVE_PROJECT_EVENT, onSwitch);
    return () => window.removeEventListener(ACTIVE_PROJECT_EVENT, onSwitch);
  }, []);

  async function createProject(data: { name: string; brief: string; repoPath?: string }) {
    if (!data.name.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(await res.text());
      const project = (await res.json()) as Project;
      setProjects((prev) => [
        { ...project, stats: { memoryCount: 0, taskCount: 0, lastTaskAt: null } },
        ...prev,
      ]);
      setProjectId(project.id);
      setNewOpen(false);
      taRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke oprette projektet");
    }
  }

  async function saveProjectRepo(path: string | null) {
    if (!projectId) return;
    setSavingRepo(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: path }),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = (await res.json()) as Project;
      setProjects((prev) =>
        prev.map((p) => (p.id === updated.id ? { ...updated, stats: p.stats } : p)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme repo");
    } finally {
      setSavingRepo(false);
    }
  }

  async function run() {
    if (!task.trim() || starting || !projectId) return;
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { runId } = (await res.json()) as { runId: string };
      router.push(`/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke starte opgaven");
      setStarting(false);
    }
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="loading loading-spinner loading-md text-dim" />
      </div>
    );
  }

  // First-ever project, or the "Nyt" flow → full-screen create view.
  if (projects.length === 0 || newOpen) {
    return (
      <CreateProjectView
        firstEver={projects.length === 0}
        repos={repos}
        error={error}
        onCreate={createProject}
        onCancel={() => {
          setNewOpen(false);
          setError(null);
        }}
      />
    );
  }

  const mem = selected?.stats;
  const projectRepo =
    typeof selected?.settings?.repoPath === "string" ? (selected.settings.repoPath as string) : "";

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto px-6 sm:px-8">
      <div className="w-full max-w-2xl pb-20 pt-[7vh]">
        {/* project header */}
        <div className="rise mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="mb-2 text-xs uppercase tracking-[0.35em] text-dim">Arbejder i projekt</p>
              <h1 className="display truncate text-4xl font-extrabold leading-[1.08] tracking-tight">
                {selected?.name}
              </h1>
              {selected?.brief?.trim() && (
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-dim">{selected.brief}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="select select-sm max-w-[10rem] border-line bg-elev"
                aria-label="Skift projekt"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="btn btn-ghost btn-sm gap-1 text-dim hover:text-fg"
              >
                <LuFolderPlus className="h-4 w-4" /> Nyt
              </button>
            </div>
          </div>

          {/* memory + team */}
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-dim">
              <LuBrain className="h-3.5 w-3.5" />
              {mem && mem.memoryCount > 0 ? (
                <span>
                  <span className="text-fg/80">{mem.memoryCount} ting husket</span> · sidste opgave{" "}
                  {relTime(mem.lastTaskAt)}
                </span>
              ) : (
                <span>Ingen hukommelse endnu - første opgave</span>
              )}
            </span>
            <span className="text-line">·</span>
            <TeamRoster />
          </div>

          {/* project repo — every task inherits the choice */}
          <div className="mt-3">
            <RepoMenu
              repos={repos}
              value={projectRepo}
              onChange={saveProjectRepo}
              saving={savingRepo}
            />
          </div>
        </div>

        {rubric && <DefinitionOfDone rubric={rubric} />}

        {/* composer */}
        <div
          className="rise rounded-box border border-line bg-panel p-2 shadow-2xl shadow-black/30"
          style={{ animationDelay: "60ms" }}
        >
          <textarea
            ref={taRef}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter inserts a newline.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run();
              }
            }}
            placeholder="Beskriv opgaven… teamet henter projektets hukommelse og vælger selv om det er en hurtig eller en team-opgave."
            rows={5}
            className="w-full resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed text-fg placeholder:text-dim/50 focus:outline-none"
          />

          <div className="flex items-center justify-between gap-3 border-t border-line px-2 pb-1 pt-2">
            <span className="text-xs text-dim">
              {projectRepo
                ? `→ grundet i projektets repo (${repoLabel(projectRepo, repos)})`
                : "→ router vælger single / team"}
            </span>
            <button
              onClick={() => void run()}
              disabled={starting || !task.trim()}
              className="btn btn-primary display gap-2 font-bold normal-case"
            >
              {starting ? (
                <>
                  <span className="loading loading-spinner loading-xs" /> Starter…
                </>
              ) : (
                "Kør"
              )}
            </button>
          </div>
        </div>

        {error && <p className="rise mt-4 text-sm text-error">{error}</p>}

        <RecentTasks tasks={tasks} />

        <p className="rise mt-6 text-xs leading-relaxed text-dim" style={{ animationDelay: "120ms" }}>
          Opgaver hører til et projekt og bygger på dets hukommelse. En router afgør om en hurtig
          builder↔kritiker-runde eller en fuld arkitekt→arbejdere→lead-opdeling passer - du godkender
          bare ved gaten.
        </p>
      </div>
    </div>
  );
}
