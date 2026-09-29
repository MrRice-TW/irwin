import { MongoClient, type AggregationCursor, type FindCursor } from "mongodb";
import { randomUUID } from "node:crypto";
import type {
  Profile,
  QueryInput,
  AggregationInput,
  Page,
  Row,
  ResolvedConnection,
} from "../shared/contracts";
import { encode, decode, object, sameDocument, size } from "../shared/bson";
import {
  assertWritable,
  identity,
  partitionKey,
  updateSpec,
  replaceSpec,
} from "./policy";
import { capabilities } from "../shared/capabilities";
import { compileReadOnlyPipeline } from "../shared/aggregation";
import {
  assertSecureUserManagementTransport,
  UsersRolesService,
} from "./users-roles";

export class DatabaseService {
  private usersRoles = new UsersRolesService();
  connections = new Map<
    string,
    { client: MongoClient; profile: Profile; version: string }
  >();
  cursors = new Map<
    string,
    {
      cursor: FindCursor | AggregationCursor;
      target: QueryInput | AggregationInput;
      kind: "find" | "aggregation";
      busy: boolean;
      touched: number;
      abort: AbortController;
    }
  >();
  private pending = new Map<string, Promise<any>>();
  async connect(resolved: ResolvedConnection) {
    const id = resolved.profile.id;
    if (this.pending.has(id)) return this.pending.get(id);
    const task = this.open(resolved).finally(() => this.pending.delete(id));
    this.pending.set(id, task);
    return task;
  }
  private async detectVersion(id: string, client: MongoClient) {
    try {
      const version = (await client.db().admin().command({ buildInfo: 1 }))
        .version;
      const current = this.connections.get(id);
      if (current?.client === client) current.version = version;
    } catch {
      // Version detection is advisory and must not delay a usable connection.
    }
  }
  private async open({ profile, uri, options }: ResolvedConnection) {
    await this.close(profile.id);
    const client = new MongoClient(uri, {
      ...options,
      promoteValues: false,
      promoteLongs: false,
      maxPoolSize: 5,
      minPoolSize: 0,
      waitQueueTimeoutMS: profile.timeoutMS,
    });
    try {
      await client.connect();
      await client.db(profile.database || "admin").command({ ping: 1 });
      this.connections.set(profile.id, { client, profile, version: "unknown" });
      void this.detectVersion(profile.id, client);
      return {
        connected: true,
        version: "unknown",
        provider: profile.provider,
        capabilities: capabilities(profile.provider, "unknown"),
      };
    } catch (error) {
      await client.close();
      throw error;
    }
  }
  get(id: string) {
    const found = this.connections.get(id);
    if (!found) throw new Error("Connection is closed");
    return found;
  }
  async close(id: string) {
    await Promise.all(
      [...this.cursors]
        .filter(([, c]) => c.target.connectionId === id)
        .map(([key]) => this.cancel(key)),
    );
    const item = this.connections.get(id);
    this.connections.delete(id);
    await item?.client.close();
  }
  async closeAll() {
    await Promise.all([...this.connections.keys()].map((id) => this.close(id)));
  }
  async expireCursors() {
    await Promise.all(
      [...this.cursors]
        .filter(([, c]) => !c.busy && Date.now() - c.touched > 300000)
        .map(([id]) => this.cancel(id)),
    );
  }
  private row(doc: any, input: QueryInput): Row {
    let reason: string | undefined;
    const connection = this.get(input.connectionId);
    const capability = capabilities(
      connection.profile.provider,
      connection.version,
    );
    if (!capability.conditionalEditing)
      reason = capability.conditionalEditingReason;
    try {
      identity(
        doc,
        this.get(input.connectionId).profile,
        input.database,
        input.collection,
      );
    } catch (e) {
      reason = (e as Error).message;
    }
    if (
      Object.values(object(input.projection)).some(
        (v) =>
          !(
            typeof v === "boolean" ||
            typeof v === "number" ||
            v?._bsontype === "Int32" ||
            v?._bsontype === "Double"
          ) || ![0, 1].includes(Number(v)),
      )
    )
      reason = "Computed or transformed projections are read-only";
    return {
      ejson: encode(doc),
      editable: !reason,
      reason,
      source: !reason
        ? {
            connectionId: input.connectionId,
            database: input.database,
            collection: input.collection,
            identity: encode(
              identity(
                doc,
                this.get(input.connectionId).profile,
                input.database,
                input.collection,
              ),
            ),
          }
        : undefined,
    };
  }
  async run(input: QueryInput): Promise<Page> {
    const { client } = this.get(input.connectionId);
    const abort = new AbortController();
    const cursor = client
      .db(input.database)
      .collection(input.collection)
      .find(object(input.filter), {
        projection: object(input.projection),
        sort: object(input.sort),
        skip: input.skip,
        batchSize: input.batchSize,
        maxTimeMS: input.maxTimeMS,
        signal: abort.signal,
      });
    const cursorId = input.cursorId || randomUUID();
    if (this.cursors.has(cursorId)) throw new Error("Duplicate cursor id");
    this.cursors.set(cursorId, {
      cursor,
      target: input,
      kind: "find",
      busy: false,
      touched: Date.now(),
      abort,
    });
    try {
      return await this.next(cursorId);
    } catch (e) {
      await this.cancel(cursorId);
      throw e;
    }
  }
  async aggregate(
    input: AggregationInput,
    mode: "run" | "preview" = "run",
  ): Promise<Page> {
    const full = compileReadOnlyPipeline(input.stages);
    const pipeline =
      mode === "preview"
        ? [
            ...compileReadOnlyPipeline(
              input.stages.slice(
                0,
                (input.throughIndex ?? input.stages.length - 1) + 1,
              ),
            ),
            { $limit: 20 },
          ]
        : full;
    const { client, profile } = this.get(input.connectionId);
    assertWritable(
      profile,
      mode === "preview" ? "aggregations.preview" : "aggregations.run",
    );
    const abort = new AbortController();
    const cursor = client
      .db(input.database)
      .collection(input.collection)
      .aggregate(pipeline, {
        batchSize: mode === "preview" ? 20 : input.batchSize,
        maxTimeMS:
          mode === "preview"
            ? Math.min(input.maxTimeMS, 10000)
            : input.maxTimeMS,
        allowDiskUse: false,
        signal: abort.signal,
      });
    const cursorId = input.cursorId || randomUUID();
    if (this.cursors.has(cursorId)) throw new Error("Duplicate cursor id");
    this.cursors.set(cursorId, {
      cursor,
      target: mode === "preview" ? { ...input, batchSize: 20 } : input,
      kind: "aggregation",
      busy: false,
      touched: Date.now(),
      abort,
    });
    try {
      return await this.next(cursorId);
    } catch (error) {
      await this.cancel(cursorId);
      throw error;
    }
  }
  async explainAggregation(input: AggregationInput): Promise<string> {
    const pipeline = compileReadOnlyPipeline(input.stages);
    const { client, profile } = this.get(input.connectionId);
    assertWritable(profile, "aggregations.explain");
    const cursor = client
      .db(input.database)
      .collection(input.collection)
      .aggregate(pipeline, { maxTimeMS: input.maxTimeMS, allowDiskUse: false });
    try {
      return encode(await cursor.explain("executionStats"));
    } finally {
      await cursor.close();
    }
  }
  async count(input: QueryInput): Promise<number> {
    const { client } = this.get(input.connectionId);
    const total = await client
      .db(input.database)
      .collection(input.collection)
      .countDocuments(object(input.filter), { maxTimeMS: input.maxTimeMS });
    return Number(total);
  }
  async next(cursorId: string): Promise<Page> {
    const state = this.cursors.get(cursorId);
    if (!state) throw new Error("Cursor expired; run the query again");
    if (state.busy) throw new Error("Cursor already reading");
    state.busy = true;
    state.touched = Date.now();
    const start = performance.now();
    const rows: Row[] = [];
    let bytes = 0;
    try {
      while (
        rows.length < state.target.batchSize &&
        bytes < 8 * 1024 * 1024 &&
        (await state.cursor.hasNext())
      ) {
        const doc = await state.cursor.next();
        if (doc === null) break;
        const row: Row =
          state.kind === "aggregation"
            ? {
                ejson: encode(doc),
                editable: false,
                reason: "Aggregation results are read-only",
              }
            : this.row(doc, state.target as QueryInput);
        bytes += row.ejson.length * 2;
        rows.push(row);
      }
      const hasMore = await state.cursor.hasNext();
      if (!hasMore) await this.cancel(cursorId);
      return {
        cursorId,
        rows,
        hasMore,
        elapsedMS: Math.round(performance.now() - start),
      };
    } finally {
      state.busy = false;
    }
  }
  async cancel(id: string) {
    const state = this.cursors.get(id);
    this.cursors.delete(id);
    state?.abort.abort();
    try {
      await state?.cursor.close();
    } catch {
      /* Cursor can already have been closed by a cancelled read. */
    }
  }
  async execute(command: string, p: any): Promise<any> {
    if (command.startsWith("usersRoles.")) {
      const { client, profile } = this.get(p.connectionId);
      if (profile.provider !== "mongodb")
        throw new Error(
          "User and role management through MongoDB commands is available only for self-managed MongoDB. Atlas and Cosmos use separate administration APIs.",
        );
      if (
        command !== "usersRoles.inspect" &&
        command !== "usersRoles.userDetails"
      ) {
        assertWritable(profile, command);
        assertSecureUserManagementTransport(profile);
      }
      switch (command) {
        case "usersRoles.inspect":
          return this.usersRoles.inspect(client, profile);
        case "usersRoles.userDetails":
          return this.usersRoles.userDetails(
            client,
            p.authDatabase,
            p.username,
          );
        case "usersRoles.createUser":
          return this.usersRoles.createUser(client, p);
        case "usersRoles.setPassword":
          return this.usersRoles.setPassword(client, p);
        case "usersRoles.grantRole":
          return this.usersRoles.grantRole(client, p);
        case "usersRoles.revokeRole":
          return this.usersRoles.revokeRole(client, p);
        case "usersRoles.dropUser":
          return this.usersRoles.dropUser(client, profile, p);
      }
    }
    if (command === "aggregations.run") return this.aggregate(p);
    if (command === "aggregations.preview") return this.aggregate(p, "preview");
    if (command === "aggregations.explain") return this.explainAggregation(p);
    if (command === "queries.run") return this.run(p);
    if (command === "queries.count") return this.count(p);
    if (command === "queries.next") return this.next(p.cursorId);
    if (command === "queries.cancel") return this.cancel(p.cursorId);
    const { client, profile } = this.get(p.connectionId);
    assertWritable(profile, command);
    const db = client.db(p.database || profile.database);
    const collection = p.collection ? db.collection(p.collection) : undefined;
    switch (command) {
      case "metadata.databases": {
        try {
          return {
            names: (
              await client
                .db()
                .admin()
                .listDatabases({ nameOnly: true, authorizedDatabases: true })
            ).databases.map((v) => v.name),
            restricted: false,
          };
        } catch (e: any) {
          if (e.code !== 13 && e.codeName !== "Unauthorized") throw e;
          return { names: [profile.database], restricted: true };
        }
      }
      case "metadata.collections":
        return (await db.listCollections({}, { nameOnly: true }).toArray()).map(
          (v) => ({ name: v.name, type: v.type }),
        );
      case "metadata.indexes":
        return encode(await collection!.listIndexes().toArray());
      case "metadata.createCollection":
        if (profile.provider === "cosmos")
          throw new Error(
            "Create Cosmos collections in Azure with the intended partition key and RU policy",
          );
        await db.createCollection(p.collection);
        return { created: true };
      case "metadata.drop":
        if (p.confirmation !== (p.collection || p.database))
          throw new Error("Confirmation does not match target");
        return p.collection ? collection!.drop() : db.dropDatabase();
      case "metadata.createIndex":
        if (profile.provider === "cosmos") {
          const keys = object(p.keys);
          if (
            Object.values(keys).some((v) =>
              ["text", "hashed", "2d"].includes(v as string),
            )
          )
            throw new Error(
              "Cosmos RU does not support text, hashed or 2d indexes.",
            );
          if (p.unique)
            throw new Error(
              "Create Cosmos unique indexes through Azure after checking collection state, backup policy and partition key constraints.",
            );
          if (p.expireAfterSeconds !== undefined)
            throw new Error(
              "Enable and configure Cosmos custom TTL in Azure before creating a TTL index.",
            );
        }
        return collection!.createIndex(object(p.keys), {
          ...(p.name ? { name: p.name } : {}),
          unique: p.unique,
          ...(p.expireAfterSeconds !== undefined
            ? { expireAfterSeconds: p.expireAfterSeconds }
            : {}),
        });
      case "metadata.editIndex": {
        if (p.oldName === "_id_") throw new Error("Cannot edit the _id index");
        const keys = object(p.keys);
        if (profile.provider === "cosmos") {
          if (
            Object.values(keys).some((v) =>
              ["text", "hashed", "2d"].includes(v as string),
            )
          )
            throw new Error(
              "Cosmos RU does not support text, hashed or 2d indexes.",
            );
          if (p.unique)
            throw new Error(
              "Configure Cosmos unique indexes in Azure before editing.",
            );
          if (p.expireAfterSeconds !== undefined)
            throw new Error(
              "Configure Cosmos custom TTL in Azure before editing.",
            );
        }
        await collection!.dropIndex(p.oldName);
        return collection!.createIndex(keys, {
          ...(p.name ? { name: p.name } : {}),
          unique: p.unique,
          ...(p.expireAfterSeconds !== undefined
            ? { expireAfterSeconds: p.expireAfterSeconds }
            : {}),
        });
      }
      case "metadata.dropIndex":
        if (p.name === "_id_") throw new Error("Cannot drop the _id index");
        return collection!.dropIndex(p.name);
      case "queries.explain":
        return encode(
          await collection!
            .find(object(p.filter), {
              projection: object(p.projection),
              sort: object(p.sort),
              maxTimeMS: p.maxTimeMS,
            })
            .explain("executionStats"),
        );
      case "documents.fetch": {
        const original = object(p.original);
        const current = await collection!.findOne(
          identity(original, profile, p.database, p.collection),
        );
        if (!current)
          throw new Error("Document was deleted; refresh the query");
        return { ejson: encode(current) };
      }
      case "documents.insert": {
        const doc = object(p.document);
        if (size(doc) > 16 * 1024 * 1024)
          throw new Error("Document exceeds 16 MB");
        const pk = partitionKey(profile, p.database, p.collection);
        if (profile.provider === "cosmos" && !pk)
          throw new Error(
            "Configure the Cosmos partition key before inserting",
          );
        if (pk)
          identity(
            { ...doc, _id: doc._id ?? "new" },
            profile,
            p.database,
            p.collection,
          );
        return encode(await collection!.insertOne(doc));
      }
      case "documents.update": {
        const capability = capabilities(
          profile.provider,
          this.get(p.connectionId).version,
        );
        if (!capability.conditionalEditing)
          throw new Error(capability.conditionalEditingReason);
        const original = object(p.original);
        const spec = updateSpec(
          original,
          p.field,
          decode(p.value),
          profile,
          p.database,
          p.collection,
        );
        const result = await collection!.updateOne(spec.filter, spec.update, {
          upsert: false,
        });
        if (!result.acknowledged)
          throw new Error(
            "Write was not acknowledged; refresh before retrying",
          );
        if (Number(result.matchedCount) !== 1)
          throw new Error(
            "Conflict: document was changed or deleted; refresh first",
          );
        const fresh = await collection!.findOne(
          identity(original, profile, p.database, p.collection),
        );
        return {
          row: fresh
            ? {
                ejson: encode(fresh),
                editable: true,
                source: {
                  connectionId: p.connectionId,
                  database: p.database,
                  collection: p.collection,
                  identity: encode(
                    identity(fresh, profile, p.database, p.collection),
                  ),
                },
              }
            : null,
          update: encode(spec),
        };
      }
      case "documents.replace": {
        const capability = capabilities(
          profile.provider,
          this.get(p.connectionId).version,
        );
        if (!capability.conditionalEditing)
          throw new Error(capability.conditionalEditingReason);
        const original = object(p.original);
        const replacement = object(p.document);
        if (size(replacement) > 16 * 1024 * 1024)
          throw new Error("Document exceeds 16 MB");
        const spec = replaceSpec(
          original,
          replacement,
          profile,
          p.database,
          p.collection,
        );
        const result = await collection!.replaceOne(
          spec.filter,
          spec.replacement,
          { upsert: false },
        );
        if (!result.acknowledged)
          throw new Error(
            "Write was not acknowledged; refresh before retrying",
          );
        if (Number(result.matchedCount) !== 1) {
          // BSON document equality is field-order sensitive. A server can return
          // the same document with a different field order after a projection or
          // rewrite, so verify the snapshot semantically before the safe fallback.
          const current = await collection!.findOne(
            identity(original, profile, p.database, p.collection),
          );
          if (!current || !sameDocument(current, original))
            throw new Error(
              "Conflict: document was changed or deleted; refresh first",
            );
          const fallback = await collection!.replaceOne(
            identity(original, profile, p.database, p.collection),
            spec.replacement,
            { upsert: false },
          );
          if (!fallback.acknowledged || Number(fallback.matchedCount) !== 1)
            throw new Error(
              "Conflict: document was changed or deleted; refresh first",
            );
        }
        const fresh = await collection!.findOne(
          identity(replacement, profile, p.database, p.collection),
        );
        return fresh
          ? {
              ejson: encode(fresh),
              editable: true,
              source: {
                connectionId: p.connectionId,
                database: p.database,
                collection: p.collection,
                identity: encode(
                  identity(fresh, profile, p.database, p.collection),
                ),
              },
            }
          : null;
      }
      case "documents.delete": {
        const result = await collection!.deleteOne(
          identity(object(p.original), profile, p.database, p.collection),
        );
        if (!result.acknowledged || Number(result.deletedCount) !== 1)
          throw new Error("Document was not deleted; refresh first");
        return { deleted: true };
      }
      default:
        throw new Error(`Unknown database command: ${command}`);
    }
  }
}
