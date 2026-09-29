import { contextBridge, ipcRenderer } from "electron";
import type { WorkbenchApi, AppEvent } from "../shared/contracts";
const api: WorkbenchApi = {
  request: (command, payload) =>
    ipcRenderer
      .invoke("workbench:request", command, payload)
      .then((response) => {
        if (!response.ok) throw new Error(response.error);
        return response.result;
      }),
  subscribe(listener) {
    const callback = (_: unknown, event: AppEvent) => listener(event);
    ipcRenderer.on("workbench:event", callback);
    return () => ipcRenderer.removeListener("workbench:event", callback);
  },
};
contextBridge.exposeInMainWorld("workbench", api);
