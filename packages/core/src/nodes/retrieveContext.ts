import type { ProjectMemory } from "../memory.js";
import type { GraphStateType } from "../state.js";

/**
 * START node for project tasks: pulls the project brief + top-k relevant memory
 * for the task and packs it into `state.context`, which every agent then sees.
 */
export function makeRetrieveContextNode(memory: ProjectMemory) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    if (!state.projectId) return { context: "" };

    const { brief, hits } = await memory.retrieve(state.projectId, state.task);
    const parts: string[] = [];
    if (brief.trim()) parts.push(`## Project brief\n${brief}`);
    if (hits.length > 0) {
      parts.push(
        `## Relevant prior work on this project\n${hits
          .map((h) => `- (${h.kind}) ${h.content}`)
          .join("\n")}`,
      );
    }
    const context = parts.join("\n\n");

    return {
      context,
      status: "running",
      messages: context
        ? [
            {
              agent: "system" as const,
              role: "system" as const,
              content: `Retrieved project brief + ${hits.length} relevant memory item(s).`,
            },
          ]
        : [],
    };
  };
}
