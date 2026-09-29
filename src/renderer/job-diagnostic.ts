import type { JobProgress } from "../shared/contracts";

function redact(value: string | undefined) {
  return (value || "")
    .replace(/(mongodb(?:\+srv)?:\/\/)[^@\s]+@/gi, "$1[credentials]@")
    .replace(/((?:password|passphrase|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

export function jobDiagnosticText(job: JobProgress) {
  return JSON.stringify(
    {
      jobId: job.jobId,
      status: job.status,
      processed: job.processed,
      failed: job.failed,
      bytes: job.bytes,
      message: redact(job.message),
      path: job.path,
      errorPath: job.errorPath,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  );
}
