"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The active project, shared between the LeftRail and the composer.
 *
 * Backed by localStorage so it survives reloads, with a custom event for
 * same-tab sync (the `storage` event only fires in *other* tabs) and the
 * native `storage` event for cross-tab sync. Both the rail and the composer
 * read/write through this hook so switching a project in one updates the other.
 */
const KEY = "agent.activeProject";
const EVENT = "agent:active-project";
/** A one-shot signal: open the "new project" panel on the composer. */
const NEW_PROJECT_KEY = "agent.openNewProject";
const NEW_PROJECT_EVENT = "agent:new-project";

export function getActiveProject(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY) ?? "";
}

export function setActiveProject(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, id);
  window.dispatchEvent(new Event(EVENT));
}

export function useActiveProject(): [string, (id: string) => void] {
  // Start empty to match SSR; hydrate from storage after mount.
  const [id, setId] = useState("");

  useEffect(() => {
    setId(getActiveProject());
    const sync = () => setId(getActiveProject());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const set = useCallback((next: string) => setActiveProject(next), []);
  return [id, set];
}

/** Ask the composer to open its "new project" panel (works across navigation). */
export function requestNewProject(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(NEW_PROJECT_KEY, "1");
  window.dispatchEvent(new Event(NEW_PROJECT_EVENT));
}

/** Consume the one-shot "new project" request, if any. */
export function consumeNewProjectRequest(): boolean {
  if (typeof window === "undefined") return false;
  const pending = window.sessionStorage.getItem(NEW_PROJECT_KEY) === "1";
  if (pending) window.sessionStorage.removeItem(NEW_PROJECT_KEY);
  return pending;
}

export { NEW_PROJECT_EVENT, EVENT as ACTIVE_PROJECT_EVENT };
