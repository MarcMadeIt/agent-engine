/**
 * Wire types for the agent-engine HTTP API.
 * Single source of truth — `apps/api` imports these so the service and the
 * client can never drift apart.
 */

export type ApiRunStatus =
  | "running"
  | "awaiting_human"
  | "accepted"
  | "rejected"
  | "failed";

export interface ApiCriterion {
  id: string;
  label: string;
  met: boolean;
  required: boolean;
}

export interface ApiVerdict {
  pass: boolean;
  score: number;
  issues: string[];
  criteria?: ApiCriterion[];
}

export type AgentRole =
  | "builder"
  | "critic"
  | "human"
  | "system"
  | "analyst"
  | "architect"
  | "lead"
  | "worker";

export interface ApiMessage {
  agent: AgentRole;
  role: "assistant" | "user" | "system";
  content: string;
}

export interface StartRunRequest {
  task: string;
  rubricId?: string;
  mode?: "single" | "team";
  repoPath?: string;
  options?: { maxRounds?: number };
}

export interface StartRunResponse {
  runId: string;
  threadId: string;
  status: "running";
}

export interface RunDetail {
  runId: string;
  threadId: string;
  task: string;
  status: ApiRunStatus;
  round: number;
  tokensUsed: number;
  draft: string;
  verdict: ApiVerdict | null;
  messages: ApiMessage[];
}

export interface RunSummary {
  runId: string;
  task: string;
  status: ApiRunStatus;
  createdAt: string;
}

export interface RepoInfo {
  name: string;
  path: string;
}

/** Rollups the composer shows alongside a project. */
export interface ProjectStats {
  /** Remembered items — non-brief project_memory rows. */
  memoryCount: number;
  taskCount: number;
  /** ISO timestamp of the most recent task, or null if none yet. */
  lastTaskAt: string | null;
}

export interface Project {
  id: string;
  name: string;
  brief: string;
  settings: Record<string, unknown>;
  createdAt: string;
  /** Present on the list endpoint; absent on create/get. */
  stats?: ProjectStats;
}

/** A task within a project, as returned by `GET /projects/:id/tasks`. */
export interface ProjectTask {
  id: string;
  projectId: string;
  task: string;
  topology: "single" | "team" | null;
  status: ApiRunStatus | string;
  createdAt: string;
}

/** A task tagged with its project name, as returned by `GET /tasks`. */
export interface RecentTask {
  id: string;
  projectId: string;
  projectName: string;
  task: string;
  topology: "single" | "team" | null;
  status: ApiRunStatus | string;
  createdAt: string;
}

export interface RubricCriterion {
  id: string;
  description: string;
  required: boolean;
}

export interface Rubric {
  criteria: RubricCriterion[];
  passThreshold: number;
}

export interface DecisionRequest {
  decision: "approve" | "reject" | "revise";
  notes?: string;
}

export interface DecisionResponse {
  runId: string;
  status: ApiRunStatus;
}

export type RunEvent =
  | { type: "token"; node: "builder" | "analyst"; content: string }
  | {
      type: "node";
      node:
        | "builder"
        | "critic"
        | "analyst"
        | "architect"
        | "lead"
        | "worker"
        | "system";
      round: number;
      content: string;
      tokens?: number;
    }
  | {
      type: "verdict";
      round: number;
      pass: boolean;
      score: number;
      issues: string[];
      criteria?: ApiCriterion[];
      tokens?: number;
    }
  | { type: "awaiting_human"; runId: string }
  | { type: "done"; status: ApiRunStatus; result: { draft: string; verdict: ApiVerdict | null } }
  | { type: "error"; message: string };
