import type { ProjectMemory } from "../memory.js";
import type { GraphStateType } from "../state.js";

/**
 * Runs after the human approves: embeds and writes the final artifact back into
 * project memory, so future tasks on the same project can retrieve it.
 */
export function makePersistMemoryNode(memory: ProjectMemory) {
  return async (state: GraphStateType): Promise<Partial<GraphStateType>> => {
    if (!state.projectId || !state.draft.trim()) return {};
    try {
      await memory.store(state.projectId, "artifact", state.draft);
    } catch {
      // Persistence is best-effort — never fail an accepted run on a write error.
      return {};
    }
    return {
      messages: [
        {
          agent: "system",
          role: "system",
          content: "Persisted the result to project memory.",
        },
      ],
    };
  };
}
