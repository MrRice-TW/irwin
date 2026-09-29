import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { Storage } from "../src/main/storage";
import { profileSchema } from "../src/shared/contracts";

const directories: string[] = [];
const openStorage = () => {
  const directory = mkdtempSync(join(tmpdir(), "irwin-ai-test-"));
  directories.push(directory);
  return new Storage(join(directory, "data.sqlite"));
};

afterEach(() => {
  while (directories.length)
    rmSync(directories.pop()!, { recursive: true, force: true });
});

describe("AI settings storage", () => {
  it("keeps provider keys out of provider metadata and encrypts them at rest", () => {
    const storage = openStorage();
    try {
      const provider = {
        id: "provider-1",
        name: "Local model",
        kind: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "qwen3",
        allowInsecureHttp: false,
      };
      storage.saveAiProvider(provider, "local-secret");

      expect(storage.settings().aiDefaultProviderId).toBe("");
      expect(JSON.stringify(storage.aiProviders())).not.toContain(
        "local-secret",
      );
      expect(storage.aiProviders()[0]).toMatchObject({
        id: "provider-1",
        hasApiKey: true,
        persistentApiKey: true,
      });
      expect(storage.aiProvider("provider-1").apiKey).toBe("local-secret");
    } finally {
      storage.close();
    }
  });

  it("defaults connection AI to disabled and removes overrides with the connection", () => {
    const storage = openStorage();
    try {
      const profile = profileSchema.parse({
        id: "connection-1",
        name: "Local MongoDB",
        uri: "mongodb://localhost:27017",
      });
      storage.save(profile, {});
      storage.saveAiProvider({
        id: "provider-1",
        name: "Local model",
        kind: "openai-compatible",
        baseUrl: "http://localhost:11434/v1",
        model: "qwen3",
        allowInsecureHttp: false,
      });

      expect(storage.aiConnection(profile.id).enabled).toBe(false);
      storage.setAiConnection({
        connectionId: profile.id,
        enabled: true,
        providerId: "provider-1",
      });
      expect(storage.aiConnection(profile.id).providerId).toBe("provider-1");
      storage.delete(profile.id);
      expect(storage.aiConnection(profile.id).enabled).toBe(false);
    } finally {
      storage.close();
    }
  });
});
