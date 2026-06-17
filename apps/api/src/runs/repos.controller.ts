import { Controller, Get, Inject } from "@nestjs/common";
import type { RepoInfo } from "@arzonic/agent-shared";
import { RunsService } from "./runs.service.js";

@Controller("repos")
export class ReposController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Get()
  list(): Promise<RepoInfo[]> {
    return this.runs.listRepos();
  }
}
