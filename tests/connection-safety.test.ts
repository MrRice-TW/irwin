import { expect, test } from "vitest";
import * as contracts from "../src/shared/contracts";
import { profileSchema } from "../src/shared/contracts";

const profile = profileSchema.parse({
  id: "prod",
  name: "Orders",
  uri: "mongodb://127.0.0.1:27017",
  environment: "staging",
  readOnly: false,
});

test("switching a connection into Production enables read-only by default", () => {
  expect(profileSchema.parse({ ...profile, environment: "production", readOnly: undefined })).toMatchObject({
    environment: "production",
    readOnly: true,
  });
});

test("loading an existing writable Production connection does not silently rewrite it", () => {
  const existing = { ...profile, environment: "production" as const };
  expect(profileSchema.parse(existing)).toMatchObject({
    environment: "production",
    readOnly: false,
  });
});

test("changing an existing staging connection to Production turns on read-only", () => {
  expect(contracts).toHaveProperty("withEnvironment");
  expect((contracts as any).withEnvironment(profile, "production")).toMatchObject({
    environment: "production",
    readOnly: true,
  });
});

test("changing away from Production keeps the user's read-only protection", () => {
  expect(contracts).toHaveProperty("withEnvironment");
  expect(
    (contracts as any).withEnvironment(
      { ...profile, environment: "production", readOnly: true },
      "staging",
    ),
  ).toMatchObject({ environment: "staging", readOnly: true });
});
