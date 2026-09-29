import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

let AIAssistantPanel: typeof import("../src/renderer/AIAssistantPanel").AIAssistantPanel;

beforeAll(async () => {
  vi.stubGlobal("window", { workbench: {} });
  ({ AIAssistantPanel } = await import("../src/renderer/AIAssistantPanel"));
});

const assistantProps = {
  connectionId: "qa",
  database: "test",
  collection: "orders",
  task: "explain" as const,
  language: "en" as const,
  profileProvider: "mongodb" as const,
  collectionNames: [],
  fieldHints: [],
  onClose: () => {},
  onOpenPreferences: () => {},
};

describe("AI assistant presentation", () => {
  it("renders Explain assistance inline without creating a second modal", () => {
    const html = renderToStaticMarkup(
      createElement(AIAssistantPanel, {
        ...assistantProps,
        embedded: true,
      }),
    );

    expect(html).toContain('class="ai-assistant-layer embedded"');
    expect(html).toContain('role="complementary"');
    expect(html).not.toContain('aria-modal="true"');
  });

  it("keeps the standalone assistant as a modal dialog", () => {
    const html = renderToStaticMarkup(
      createElement(AIAssistantPanel, assistantProps),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('data-ai-focus-trap="true"');
  });
});
