import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loadHelper() {
  return import(
    /* @vite-ignore */ new URL(
      "./e2e/helpers/close-electron.mjs",
      import.meta.url,
    ).href
  );
}

function fixture(blocked = false, exitCode = 0, waitsForInspector = false) {
  const child = Object.assign(new EventEmitter(), {
    pid: 123,
    exitCode: null as number | null,
    signalCode: null,
  });
  const pageEvents = new EventEmitter();
  const appEvents = new EventEmitter();
  let closed = false;
  let inspectorDisconnected = false;
  const order: string[] = [];
  const window = {
    close() {
      order.push("window.close");
      if (!blocked) {
        closed = true;
        pageEvents.emit("close");
        if (waitsForInspector) appEvents.emit("will-quit");
      }
    },
    isVisible: () => !closed,
    isDestroyed: () => closed,
  };
  const app = {
    process: () => child,
    windows: () => [
      {
        isClosed: () => closed,
        waitForEvent: (_event: string, { timeout }: { timeout: number }) =>
          new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Window close timed out")),
              timeout,
            );
            pageEvents.once("close", () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      },
    ],
    evaluate: async (callback: (args: unknown) => unknown) =>
      callback({
        BrowserWindow: { getAllWindows: () => [window] },
        app: {
          isReady: () => true,
          once: appEvents.once.bind(appEvents),
        },
      }),
    close: vi.fn(async () => {
      order.push("debugger.detach");
      if (waitsForInspector && !inspectorDisconnected)
        await new Promise(() => {});
      child.exitCode = exitCode;
      order.push("process.exit");
      child.emit("exit", exitCode, null);
    }),
  };
  return {
    app,
    order,
    detachInspector: () => {
      inspectorDisconnected = true;
      order.push("inspector.detach");
    },
  };
}

test("normal Electron close releases the debugger before waiting for process exit", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, order } = fixture();
  const check = expect(
    closeElectronWindowNormally(app),
  ).resolves.toBeUndefined();
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(order).toEqual(["window.close", "debugger.detach", "process.exit"]);
});

test("a prevented window close is not bypassed by quitting through Playwright", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app } = fixture(true);
  const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
    "windows did not close",
  );
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(app.close).not.toHaveBeenCalled();
});

test("an abnormal Electron exit cannot pass normal shutdown validation", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app } = fixture(false, 42);
  const check = expect(closeElectronWindowNormally(app)).rejects.toThrow(
    "exitCode=42",
  );
  await Promise.all([check, vi.runAllTimersAsync()]);
});

test("normal quit detaches the inspector before an RPC to a shutting-down main process can hang", async () => {
  vi.useFakeTimers();
  const { closeElectronWindowNormally } = await loadHelper();
  const { app, order, detachInspector } = fixture(false, 0, true);
  const originalGetBuiltinModule = process.getBuiltinModule.bind(process);
  vi.spyOn(process, "getBuiltinModule").mockImplementation((name) =>
    name === "node:inspector"
      ? ({ close: detachInspector } as ReturnType<
          typeof process.getBuiltinModule
        >)
      : originalGetBuiltinModule(name),
  );
  const check = expect(
    closeElectronWindowNormally(app),
  ).resolves.toBeUndefined();
  await Promise.all([check, vi.runAllTimersAsync()]);
  expect(order).toEqual([
    "window.close",
    "inspector.detach",
    "debugger.detach",
    "process.exit",
  ]);
});
