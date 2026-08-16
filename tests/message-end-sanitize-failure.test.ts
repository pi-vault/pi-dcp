import { describe, expect, it, vi } from "vitest";
import createExtension from "../src/index.ts";

const agentDir = vi.hoisted(() => `/tmp/dcp-message-end-test-${Date.now()}-${Math.random()}`);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => agentDir,
}));

type Handler = (...args: never[]) => unknown;

function createMockApi() {
  const handlers = new Map<string, Handler[]>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const commands = new Map<string, unknown>();
  const tools = new Map<string, unknown>();
  const api = {
    on(event: string, handler: Handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool);
    },
    registerCommand(name: string, command: unknown) {
      commands.set(name, command);
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionAPI;
  return { api, handlers, entries, commands, tools };
}

function makeSessionStartCtx() {
  return {
    sessionManager: {
      getSessionDir: () => "/tmp/dcp-test-session",
      getSessionId: () => "test-session",
      getBranch: () => [] as unknown[],
    },
    getContextUsage: () => undefined,
  };
}

describe("message_end sanitizer failure handling", () => {
  it("emits info notify when sanitizer strips inline residual metadata", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0] as (...args: unknown[]) => Promise<unknown>;
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Let me cast:\n\n\n\n-dcp-message-id>" }],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("stripped residual"), "info");
    // Handler must return the stripped message so the agent sees the
    // sanitized text on its next pass.
    expect(result).toHaveProperty("message");
    const strippedContent = (result as { message: { content: Array<{ text: string }> } }).message
      .content;
    expect(strippedContent[0].text).not.toContain("dcp-message-id");
  });

  it("emits info notify when sanitizer strips a bare known ref", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    // Drive a context pass so byRawId is populated with m0001.
    const context = handlers.get("context")?.[0] as (...args: unknown[]) => Promise<unknown>;
    await context(
      {
        messages: [{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 }],
      },
      { ...makeSessionStartCtx(), getContextUsage: () => undefined, hasUI: false },
    );

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0] as (...args: unknown[]) => Promise<unknown>;
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Sort the selected names alphabetically on enter:\n\n\n\nm0001",
            },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("stripped residual"), "info");
    const strippedText = (result as { message: { content: Array<{ text: string }> } }).message
      .content[0].text;
    expect(strippedText).not.toContain("m0001");
  });

  it("emits warning notify when sanitizer is a no-op but residual pattern remains", async () => {
    // Shape the residual regex can't catch: dcp-message-id embedded in a
    // larger identifier. The boundary check `(^|[^\w-])` prevents matching
    // inside `xdcp-message-idy`, so the strip pipeline returns the text
    // unchanged. The heuristic still detects the substring and fires the
    // warning. Defense-in-depth branch.
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0] as (...args: unknown[]) => Promise<unknown>;
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "all clear xdcp-message-idy still here" }],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("model output looked malformed"),
      "warning",
    );
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("stripped residual"), "info");
    // No stripping happened, so no message replacement.
    expect(result).toBeUndefined();
  });

  it("does not notify on a clean message with a tool call", async () => {
    const { api, handlers } = createMockApi();
    createExtension(api);
    const sessionStart = handlers.get("session_start")?.[0] as (
      ...args: unknown[]
    ) => Promise<unknown>;
    await sessionStart({ reason: "new" }, makeSessionStartCtx());

    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { setStatus: vi.fn(), notify } };
    const messageEnd = handlers.get("message_end")?.[0] as (...args: unknown[]) => Promise<unknown>;
    const result = await messageEnd(
      {
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "All done." },
            {
              type: "toolCall",
              id: "tc-1",
              name: "read",
              arguments: { path: "/tmp/x" },
            },
          ],
          stopReason: "stop",
          timestamp: Date.now(),
        },
      },
      ctx,
    );

    expect(notify).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
