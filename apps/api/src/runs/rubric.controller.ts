import { Controller, Get } from "@nestjs/common";
import { defaultRubric, type Rubric } from "@arzonic/agent-core";

/**
 * The active "Definition of Done" the critic scores every draft against.
 * Read-only for now — the composer surfaces it so the user sees the quality
 * bar before running. When per-project rubrics land, this becomes `:id/rubric`.
 */
@Controller("rubric")
export class RubricController {
  @Get()
  get(): Rubric {
    return defaultRubric;
  }
}
