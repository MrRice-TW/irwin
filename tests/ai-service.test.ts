import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/shared/ai";
import { validateAiEndpoint } from "../src/shared/ai";
import {
  assistantSystemPrompt,
  requestAiProvider,
  testAiProvider,
} from "../src/main/ai-service";

const provider = (kind: AiProvider["kind"]): AiProvider => ({
  id: "provider-1",
  name: "Test provider",
  kind,
  baseUrl:
    kind === "anthropic"
      ? "https://api.anthropic.com"
      : kind === "gemini"
        ? "https://generativelanguage.googleapis.com"
        : "https://llm.example.test/v1",
  model: "test-model",
  allowInsecureHttp: false,
});

describe("LLM endpoint policy", () => {
  it("allows HTTPS and loopback HTTP, but requires explicit consent for LAN HTTP", () => {
    expect(validateAiEndpoint("https://llm.example.test/v1", false).ok).toBe(
      true,
    );
    expect(validateAiEndpoint("http://localhost:11434/v1", false).ok).toBe(
      true,
    );
    expect(validateAiEndpoint("http://192.168.1.8:11434/v1", false).ok).toBe(
      false,
    );
    expect(validateAiEndpoint("http://192.168.1.8:11434/v1", true).ok).toBe(
      true,
    );
    expect(validateAiEndpoint("http://public.example.test/v1", true).ok).toBe(
      false,
    );
  });

  it("rejects embedded credentials and query strings in endpoint URLs", () => {
    expect(
      validateAiEndpoint("https://user:pass@llm.example.test/v1", false).ok,
    ).toBe(false);
    expect(
      validateAiEndpoint("https://llm.example.test/v1?key=secret", false).ok,
    ).toBe(false);
  });
});

describe("provider adapters", () => {
  it("supports Traditional Chinese and English requests regardless of UI language", () => {
    expect(assistantSystemPrompt("zh", "query")).toContain("英文");
    expect(assistantSystemPrompt("en", "query")).toContain(
      "Traditional Chinese",
    );
  });

  it("gives aggregation requests the complete validated draft shape", () => {
    const aggregationShape =
      '"kind":"draft","mode":"aggregation","summary":"...","assumptions":[],"fieldsUsed":["status"],"stages":[{"$group":{"_id":"$status","count":{"$sum":1}}},{"$sort":{"count":-1}}]';

    expect(assistantSystemPrompt("en", "query")).toContain(aggregationShape);
    expect(assistantSystemPrompt("zh", "query")).toContain(aggregationShape);
  });

  it("reports chat and query-draft capabilities separately", async () => {
    const replies = [
      "The connection is working.",
      JSON.stringify({
        kind: "draft",
        mode: "find",
        summary: "test",
        assumptions: [],
        fieldsUsed: [],
        query: { filter: {}, sort: {}, projection: {} },
      }),
    ];
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: replies.shift() } }],
        }),
        { status: 200 },
      );
    const result = await testAiProvider(
      provider("openai-compatible"),
      "",
      fetcher,
    );

    expect(result).toMatchObject({
      reachable: true,
      canRespond: true,
      canGenerateDraft: true,
    });
  });

  it("keeps chat available when the provider cannot produce a valid draft", async () => {
    const replies = ["The connection is working.", "not structured output"];
    const fetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: replies.shift() } }],
        }),
        { status: 200 },
      );
    const result = await testAiProvider(
      provider("openai-compatible"),
      "",
      fetcher,
    );

    expect(result).toMatchObject({
      reachable: true,
      canRespond: true,
      canGenerateDraft: false,
    });
  });

  it("sends OpenAI-compatible messages with the key in an authorization header", async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }),
        { status: 200 },
      );
    };
    const result = await requestAiProvider(
      provider("openai-compatible"),
      "sk-secret",
      [{ role: "user", content: "Return JSON" }],
      new AbortController().signal,
      fetcher,
    );

    expect(result).toBe('{"ok":true}');
    const [url, options] = calls[0];
    expect(String(url)).toBe("https://llm.example.test/v1/chat/completions");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer sk-secret",
    );
    expect(JSON.stringify(options?.body)).not.toContain("sk-secret");
  });

  it("uses Anthropic's message format", async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "hello" }] }),
        {
          status: 200,
        },
      );
    };
    const result = await requestAiProvider(
      provider("anthropic"),
      "anthropic-secret",
      [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ],
      new AbortController().signal,
      fetcher,
    );

    expect(result).toBe("hello");
    const [url, options] = calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(options?.headers).get("x-api-key")).toBe(
      "anthropic-secret",
    );
    expect(JSON.parse(String(options?.body)).system).toBe("Be concise");
  });

  it("uses Gemini's native content format without putting the API key in the URL", async () => {
    const calls: [RequestInfo | URL, RequestInit | undefined][] = [];
    const fetcher: typeof fetch = async (url, init) => {
      calls.push([url, init]);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "hello" }] } }],
        }),
        { status: 200 },
      );
    };
    const result = await requestAiProvider(
      provider("gemini"),
      "gemini-secret",
      [{ role: "user", content: "Hello" }],
      new AbortController().signal,
      fetcher,
    );

    expect(result).toBe("hello");
    const [url, options] = calls[0];
    expect(String(url)).toContain(":generateContent");
    expect(String(url)).not.toContain("gemini-secret");
    expect(new Headers(options?.headers).get("x-goog-api-key")).toBe(
      "gemini-secret",
    );
  });

  it("does not include provider response bodies in errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("prompt content echoed by provider", { status: 500 }),
    );
    await expect(
      requestAiProvider(
        provider("openai-compatible"),
        "key",
        [{ role: "user", content: "private prompt" }],
        new AbortController().signal,
        fetcher as typeof fetch,
      ),
    ).rejects.toThrow("HTTP 500");
    await expect(
      requestAiProvider(
        provider("openai-compatible"),
        "key",
        [{ role: "user", content: "private prompt" }],
        new AbortController().signal,
        fetcher as typeof fetch,
      ),
    ).rejects.not.toThrow("prompt content echoed by provider");
  });

  it("passes cancellation through to the model request", async () => {
    const controller = new AbortController();
    const fetcher: typeof fetch = async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    const pending = requestAiProvider(
      provider("openai-compatible"),
      "",
      [{ role: "user", content: "private prompt" }],
      controller.signal,
      fetcher,
    );
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});
