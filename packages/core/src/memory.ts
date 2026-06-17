/**
 * The memory capability the graph needs, as a pure interface. The runtime
 * injects a concrete implementation (the pgvector MemoryService in
 * `@arzonic/agent-shared`), keeping `core` framework-free.
 */
export type MemoryKind = "brief" | "artifact" | "decision" | "note";

export interface MemoryHit {
  kind: string;
  content: string;
  score: number;
}

export interface RetrievedContext {
  brief: string;
  hits: MemoryHit[];
}

export interface ProjectMemory {
  retrieve(projectId: string, query: string): Promise<RetrievedContext>;
  store(projectId: string, kind: MemoryKind, content: string): Promise<void>;
}
