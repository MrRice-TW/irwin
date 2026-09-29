import { test, expect } from "vitest";
import { ShellService } from "../src/core/shell";
import { profileSchema } from "../src/shared/contracts";
test("official mongosh evaluator preserves variables, async and BSON without a database", async () => {
  const shell = new ShellService();
  const profile = profileSchema.parse({
    id: "test",
    name: "test",
    uri: "mongodb://127.0.0.1:27017",
  });
  try {
    await shell.open({ profile, uri: profile.uri, options: {} }, "test", true);
    expect(
      (await shell.execute("let count=4; count+1")).output.join(""),
    ).toContain("5");
    expect((await shell.execute("count+=2")).output.join("")).toContain("6");
    const result = await shell.execute(
      'await Promise.resolve({ n: NumberLong("9007199254740993"), id: ObjectId("507f1f77bcf86cd799439011") })',
    );
    expect(result.rows[0].ejson).toContain("9007199254740993");
    expect(result.rows[0].ejson).toContain("$oid");
  } finally {
    await shell.close();
  }
});
