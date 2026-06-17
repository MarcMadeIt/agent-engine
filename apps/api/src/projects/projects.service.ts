import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  MemoryService,
  Project,
  ProjectWithStats,
  RecentTask,
  Task,
} from "@arzonic/agent-shared";
import { MEMORY } from "../tokens.js";

const SCRATCH_NAME = "Scratch";

@Injectable()
export class ProjectsService {
  constructor(@Inject(MEMORY) private readonly memory: MemoryService | null) {}

  private db(): MemoryService {
    if (!this.memory) {
      throw new ServiceUnavailableException(
        "Project memory is disabled — set SUPABASE_DB_URL + MISTRAL_API_KEY.",
      );
    }
    return this.memory;
  }

  get enabled(): boolean {
    return this.memory !== null;
  }

  create(
    name: string,
    brief: string,
    settings: Record<string, unknown> = {},
  ): Promise<Project> {
    return this.db().createProject(name, brief, settings);
  }

  updateSettings(id: string, patch: Record<string, unknown>): Promise<Project | null> {
    return this.db().updateProjectSettings(id, patch);
  }

  list(): Promise<ProjectWithStats[]> {
    return this.db().listProjectsWithStats();
  }

  get(id: string): Promise<Project | null> {
    return this.db().getProject(id);
  }

  listTasks(id: string): Promise<Task[]> {
    return this.db().listTasks(id);
  }

  /** Recent tasks across all projects, tagged with project name. */
  listRecent(): Promise<RecentTask[]> {
    return this.db().listRecentTasks();
  }

  delete(id: string): Promise<void> {
    return this.db().deleteProject(id);
  }

  /** The implicit project for quick, project-less tasks. Created on demand. */
  async scratchProject(): Promise<Project> {
    const existing = (await this.db().listProjects()).find((p) => p.name === SCRATCH_NAME);
    return existing ?? this.db().createProject(SCRATCH_NAME, "Ad-hoc tasks without a dedicated project.");
  }
}
