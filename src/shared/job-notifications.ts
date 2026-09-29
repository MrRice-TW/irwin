import type { JobProgress, Settings } from "./contracts";

export function jobNotificationKind(
  mode: Settings["jobNotifications"],
  job: JobProgress,
): "failed" | "completed" | undefined {
  if (mode === "off" || job.status === "running" || job.status === "cancelled")
    return undefined;
  if (job.status === "failed" || job.failed > 0) return "failed";
  if (mode === "all" && job.status === "completed") return "completed";
  return undefined;
}
