"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Assignee, Category, Stage } from "@/lib/crm/types";
import { api, tablesMissing } from "./api";

export type CrmMeta = { categories: Category[]; stages: Stage[]; assignees: Assignee[]; role: string | null; me: string };

type CrmContextValue = { meta: CrmMeta | null; error: string | null; setupNeeded: boolean; reload: () => Promise<void> };

const CrmContext = createContext<CrmContextValue>({ meta: null, error: null, setupNeeded: false, reload: async () => {} });

export const useCrm = () => useContext(CrmContext);

/**
 * Loads the CRM's lists once (categories, stages, team) and, because the request is itself role-checked on the
 * server, doubles as the gate: a Viewer is sent back to the dashboard and a signed-out user to the login page.
 */
export function CrmProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await api("/api/crm/meta");
    if (res.status === 401) return router.replace("/login");
    if (res.status === 403) return router.replace("/dashboard");
    if (!res.ok) return setError(res.body.error || "Could not load the CRM");
    setError(null);
    setMeta(res.body);
  }, [router]);

  useEffect(() => {
    reload();
  }, [reload]);

  return <CrmContext.Provider value={{ meta, error, setupNeeded: tablesMissing(error), reload }}>{children}</CrmContext.Provider>;
}

export const stageById = (meta: CrmMeta | null, id: string | null) => meta?.stages.find((s) => s.id === id) ?? null;
