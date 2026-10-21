// TanStack Query hooks, one place so cache keys stay consistent.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LoopItem, SettingsDto, StatusResponse } from "@contracts";
import { api, type JobsQuery } from "./api";

export const qk = {
  status: ["status"] as const,
  overview: ["overview"] as const,
  jobs: (q: JobsQuery) => ["jobs", q] as const,
  recent: ["jobs", "recent"] as const,
  job: (id: number | null) => ["job", id] as const,
  resumeChat: (jobId: number) => ["job", jobId, "resume-chat"] as const,
  applications: ["applications"] as const,
  application: (id: number | null) => ["application", id] as const,
  questions: (s?: string) => ["questions", s ?? "all"] as const,
  answers: ["answers"] as const,
  activity: (q: object) => ["activity", q] as const,
  loops: ["loops"] as const,
  loop: (id: number) => ["loop", id] as const,
  variants: ["variants"] as const,
  sources: ["sources"] as const,
  settings: ["settings"] as const,
};

export const useStatus = () => useQuery({ queryKey: qk.status, queryFn: api.status, refetchInterval: 30_000 });
export const useOverview = () => useQuery({ queryKey: qk.overview, queryFn: api.overview });
export const useJobs = (q: JobsQuery) => useQuery({ queryKey: qk.jobs(q), queryFn: () => api.jobs(q), placeholderData: (prev) => prev });
export const useRecentJobs = () => useQuery({ queryKey: qk.recent, queryFn: api.recentJobs });
export const useJob = (id: number | null) => useQuery({ queryKey: qk.job(id), queryFn: () => api.job(id!), enabled: id != null });
export const useResumeChat = (jobId: number) => useQuery({ queryKey: qk.resumeChat(jobId), queryFn: () => api.resumeChat(jobId) });
export const useApplications = () => useQuery({ queryKey: qk.applications, queryFn: () => api.applications() });
export const useApplication = (id: number | null) => useQuery({ queryKey: qk.application(id), queryFn: () => api.application(id!), enabled: id != null });
export const useQuestions = (status?: "pending" | "asked" | "answered") => useQuery({ queryKey: qk.questions(status), queryFn: () => api.questions(status) });
export const useAnswers = () => useQuery({ queryKey: qk.answers, queryFn: api.answers });
export const useLoops = () => useQuery({ queryKey: qk.loops, queryFn: api.loops });
export const useLoop = (id: number) => useQuery({ queryKey: qk.loop(id), queryFn: () => api.loop(id) });
export const useVariants = () => useQuery({ queryKey: qk.variants, queryFn: api.resumeVariants });
export const useSources = () => useQuery({ queryKey: qk.sources, queryFn: api.sources });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.settings });

/** After anything that changes jobs/applications/questions, refresh the lot. Cheap against a local API. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["jobs", "job", "applications", "application", "questions", "answers", "overview", "activity", "status", "loops", "loop"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

/** Loop on/off with an optimistic flip, rolled back if the request fails. */
export function useToggleLoop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => (active ? api.resumeLoop(id) : api.pauseLoop(id)),
    onMutate: async ({ id, active }) => {
      await qc.cancelQueries({ queryKey: qk.loops });
      const prev = qc.getQueryData<LoopItem[]>(qk.loops);
      qc.setQueryData<LoopItem[]>(qk.loops, (old) => old?.map((l) => (l.id === id ? { ...l, active } : l)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.loops, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["loops"] });
      void qc.invalidateQueries({ queryKey: ["loop"] });
      void qc.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

/** Settings PUT with optimistic update (dry run, source toggles, numbers). */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<SettingsDto>) => api.updateSettings(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.settings });
      const prev = qc.getQueryData<SettingsDto>(qk.settings);
      qc.setQueryData<SettingsDto>(qk.settings, (old) => (old ? { ...old, ...patch, sources: { ...old.sources, ...(patch.sources ?? {}) } } : old));
      if (patch.dryRun !== undefined) qc.setQueryData<StatusResponse>(qk.status, (old) => (old ? { ...old, dryRun: patch.dryRun! } : old));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.settings, ctx.prev),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.settings });
      void qc.invalidateQueries({ queryKey: qk.status });
      void qc.invalidateQueries({ queryKey: qk.sources });
    },
  });
}
