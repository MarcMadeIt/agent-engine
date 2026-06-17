import { Controller, Get, Inject } from "@nestjs/common";
import type { RecentTask } from "@arzonic/agent-shared";
import { ProjectsService } from "../projects/projects.service.js";

/** Global, cross-project activity feed — the sidebar's "Seneste opgaver". */
@Controller("tasks")
export class TasksController {
  constructor(@Inject(ProjectsService) private readonly projects: ProjectsService) {}

  @Get()
  list(): Promise<RecentTask[]> {
    return this.projects.listRecent();
  }
}
