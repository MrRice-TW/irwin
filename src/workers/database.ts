import { DatabaseService } from "../core/database";
import { TransferService } from "../core/transfers";
import { ExplorationService } from "../core/exploration";
import { redact } from "../core/policy";
import type { RpcMessage } from "../shared/contracts";
import { databaseError } from "../shared/capabilities";
const port = (process as any).parentPort;
const send = (value: any) =>
  port ? port.postMessage(value) : process.send?.(value);
const database = new DatabaseService();
const analysis = new ExplorationService(database, (data) =>
  send({ event: { type: "analysis", data } }),
);
const transfers = new TransferService(database, (event) =>
  send({ event: { type: "job", data: event } }),
);
async function receive({ id, command, payload }: RpcMessage) {
  try {
    let result: any;
    if (command === "connect") result = await database.connect(payload);
    else if (command === "disconnect") {
      analysis.cancelConnection(payload.id);
      await transfers.cancelConnection(payload.id);
      result = await database.close(payload.id);
    } else if (command === "transferJobs.start")
      result = transfers.start(payload);
    else if (command === "transferJobs.cancel")
      result = transfers.cancel(payload.jobId);
    else if (command === "aggregations.export")
      result = transfers.startAggregation(payload);
    else if (command === "transferJobs.preview")
      result = await transfers.preview(payload.path);
    else if (command === "analysis.schema")
      result = await analysis.schema(payload);
    else if (command === "analysis.compare")
      result = await analysis.compare(payload);
    else if (command === "analysis.cancel")
      result = analysis.cancel(payload.jobId);
    else result = await database.execute(command, payload);
    send({ id, result });
  } catch (e) {
    send({ id, error: redact(databaseError(e)) });
  }
}
if (port) port.on("message", (e: any) => void receive(e.data));
else process.on("message", (e: any) => void receive(e));
setInterval(() => void database.expireCursors(), 60000).unref();
