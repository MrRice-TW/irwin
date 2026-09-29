import { utilityProcess, type UtilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import type { AppEvent } from "../shared/contracts";
export class WorkerClient {
  private worker: UtilityProcess;
  private pending = new Map<
    string,
    {
      resolve(v: any): void;
      reject(e: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  closed = false;
  constructor(
    path: string,
    onEvent: (e: AppEvent) => void,
    onExit?: () => void,
  ) {
    this.worker = utilityProcess.fork(path, [], {
      stdio: "pipe",
      serviceName: "Irwin engine",
      env: { ...process.env, WORKBENCH_DEV_URL: "" },
    });
    this.worker.on("message", (message) => {
      if (message.event) {
        onEvent(message.event);
        return;
      }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });
    // Do not forward engine stdout/stderr: scripts and driver errors may contain data.
    this.worker.stdout?.on("data", () => {});
    this.worker.stderr?.on("data", () => {});
    this.worker.on("exit", () => {
      this.closed = true;
      this.fail(
        "Engine stopped. Unacknowledged writes may have completed; refresh before retrying.",
      );
      onExit?.();
    });
  }
  request(command: string, payload: any, timeout = 60000): Promise<any> {
    if (this.closed) return Promise.reject(new Error("Engine is closed"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Operation timed out. Refresh before retrying a write."),
        );
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, command, payload });
    });
  }
  private fail(message: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
  kill() {
    this.closed = true;
    this.fail(
      "Operation cancelled; Shell variables were reset. Completed writes are not rolled back.",
    );
    this.worker.kill();
  }
}
