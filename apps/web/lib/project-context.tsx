'use client';

// The active project: the one the top bar shows and every page works in. The choice is kept in
// localStorage (`lwa.activeProject`, every access guarded); when the stored id is missing or no
// longer exists, the earliest-created project is active, or none when there are no projects.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Project } from '@lwa/engine';
import { useStoreQuery } from '@/lib/store/provider';

export const ACTIVE_PROJECT_KEY = 'lwa.activeProject';

function readStoredId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function storeId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // Storage unavailable: the choice holds for this page only.
  }
}

const byCreation = (a: Project, b: Project): number =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The stored project when it still exists, else the earliest-created one, else null. */
export function resolveActiveProject(projects: Project[], storedId: string | null): Project | null {
  return projects.find((p) => p.id === storedId) ?? [...projects].sort(byCreation)[0] ?? null;
}

type ProjectContextValue = {
  /** Every project, oldest first; undefined while loading. */
  projects: Project[] | undefined;
  activeProject: Project | null;
  setProjectId: (id: string) => void;
  loading: boolean;
  error: Error | null;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { data, loading, error } = useStoreQuery((s) => s.projects.list(), []);
  // Rendered only inside StoreProvider, which renders children in the browser after the store
  // opens, so reading storage in the initialiser cannot disagree with a server render.
  const [storedId, setStoredId] = useState<string | null>(readStoredId);

  const setProjectId = useCallback((id: string) => {
    setStoredId(id);
    storeId(id);
  }, []);

  const value = useMemo<ProjectContextValue>(() => {
    const projects = data ? [...data].sort(byCreation) : undefined;
    return {
      projects,
      activeProject: projects ? resolveActiveProject(projects, storedId) : null,
      setProjectId,
      loading,
      error,
    };
  }, [data, storedId, setProjectId, loading, error]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

function useProjectContext(hook: string): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error(`${hook} must be used inside <ProjectProvider>`);
  return ctx;
}

/** The active project's id (null while loading or when there is none) and its setter. */
export function useProjectId(): [string | null, (id: string) => void] {
  const { activeProject, setProjectId } = useProjectContext('useProjectId');
  return [activeProject?.id ?? null, setProjectId];
}

/** All projects, the active one, and the load state of the list. */
export function useProjects(): Omit<ProjectContextValue, 'setProjectId'> {
  const { projects, activeProject, loading, error } = useProjectContext('useProjects');
  return { projects, activeProject, loading, error };
}
