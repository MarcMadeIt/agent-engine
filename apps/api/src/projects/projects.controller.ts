import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { z } from "zod";
import type { Project, ProjectWithStats, Task } from "@arzonic/agent-shared";
import type { StartRunResponse } from "@arzonic/agent-client";
import { ZodValidationPipe } from "../runs/dto/runs.dto.js";
import { RunsService } from "../runs/runs.service.js";
import { ProjectsService } from "./projects.service.js";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(200),
  brief: z.string().max(20_000).optional().default(""),
  repoPath: z.string().min(1).optional(),
});
type CreateProjectDto = z.infer<typeof CreateProjectSchema>;

// Edit name/brief and/or the bound repo. `repoPath: null` clears the repo.
const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brief: z.string().max(20_000).optional(),
  repoPath: z.string().min(1).nullable().optional(),
});
type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;

const StartTaskSchema = z.object({
  task: z.string().min(1).max(20_000),
  repoPath: z.string().min(1).optional(),
});
type StartTaskDto = z.infer<typeof StartTaskSchema>;

@Controller("projects")
export class ProjectsController {
  constructor(
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(RunsService) private readonly runs: RunsService,
  ) {}

  @Post(":id/tasks")
  startTask(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(StartTaskSchema)) dto: StartTaskDto,
  ): Promise<StartRunResponse> {
    return this.runs.startProjectTask(id, dto.task, dto.repoPath);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateProjectSchema)) dto: CreateProjectDto,
  ): Promise<Project> {
    const settings: Record<string, unknown> = {};
    if (dto.repoPath) settings.repoPath = this.runs.validateRepoPath(dto.repoPath);
    return this.projects.create(dto.name, dto.brief, settings);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) dto: UpdateProjectDto,
  ): Promise<Project> {
    let updated: Project | null = null;

    if (dto.name !== undefined || dto.brief !== undefined) {
      updated = await this.projects.update(id, { name: dto.name, brief: dto.brief });
    }

    if (dto.repoPath !== undefined) {
      const repoPath = dto.repoPath ? this.runs.validateRepoPath(dto.repoPath) : null;
      updated = await this.projects.updateSettings(id, { repoPath });
    }

    if (updated === null) {
      // Nothing to change, or the project doesn't exist — distinguish.
      updated = await this.projects.get(id);
    }
    if (!updated) throw new NotFoundException(`No project ${id}`);
    return updated;
  }

  @Get()
  list(): Promise<ProjectWithStats[]> {
    return this.projects.list();
  }

  @Get(":id")
  async get(@Param("id") id: string): Promise<Project> {
    const p = await this.projects.get(id);
    if (!p) throw new NotFoundException(`No project ${id}`);
    return p;
  }

  @Get(":id/tasks")
  listTasks(@Param("id") id: string): Promise<Task[]> {
    return this.projects.listTasks(id);
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    await this.projects.delete(id);
    return { ok: true };
  }
}
