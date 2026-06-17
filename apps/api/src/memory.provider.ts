import { MemoryService } from "@arzonic/agent-shared";
import type { ApiEnv } from "./env.js";

/**
 * Builds the pgvector-backed MemoryService and runs its idempotent schema setup.
 * Returns null when the DB or embedding key is missing — projects/memory then
 * stay disabled, but plain runs still work.
 */
export async function createMemory(env: ApiEnv): Promise<MemoryService | null> {
  if (!env.SUPABASE_DB_URL || !env.MISTRAL_API_KEY) {
    console.warn(
      "[agent-api] SUPABASE_DB_URL / MISTRAL_API_KEY missing — project memory is disabled.",
    );
    return null;
  }
  const memory = new MemoryService({
    connectionString: env.SUPABASE_DB_URL,
    mistralApiKey: env.MISTRAL_API_KEY,
  });
  await memory.setup();
  return memory;
}
