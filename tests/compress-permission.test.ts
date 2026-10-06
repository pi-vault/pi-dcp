import { describe, expect, it, vi } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  describeCompressionRequest,
  requestCompressionApproval,
} from "../src/compress/permission.ts";

function ctxFor(options: {
  mode?: ExtensionContext["mode"];
  hasUI?: boolean;
  confirm?: ReturnType<typeof vi.fn>;
  signal?: AbortSignal;
}) {
  const confirm = options.confirm ?? vi.fn();
  const ctx = {
    mode: options.mode ?? "tui",
    hasUI: options.hasUI ?? true,
    signal: options.signal,
    ui: { confirm },
  } as unknown as ExtensionContext;
  return { ctx, confirm };
}

describe("describeCompressionRequest", () => {
  it("falls back to an untitled topic for missing, empty, and whitespace topics", () => {
    expect(describeCompressionRequest("range", {}).topic).toBe("Untitled compression");
    expect(describeCompressionRequest("range", { topic: "" }).topic).toBe("Untitled compression");
    expect(describeCompressionRequest("range", { topic: "   " }).topic).toBe(
      "Untitled compression",
    );
  });

  it("uses the trimmed topic when provided", () => {
    expect(describeCompressionRequest("range", { topic: "  parser fix  " }).topic).toBe(
      "parser fix",
    );
  });

  it("counts valid range records and labels them ranges", () => {
    const primary = describeCompressionRequest("range", {
      topic: "ranges",
      content: [
        { startId: "m1", endId: "m4", summary: "a" },
        { startId: "m5", endId: "m8", summary: "b" },
        { startId: "m9", endId: 4, summary: "c" },
        { nope: true },
      ],
    });

    expect(primary).toEqual({ topic: "ranges", targetCount: 2, targetLabel: "range" });
  });

  it("counts valid message targets and labels them targets", () => {
    const primary = describeCompressionRequest("message", {
      topic: "targets",
      targets: [{ messageId: "m1", summary: "a" }],
    });

    expect(primary).toEqual({ topic: "targets", targetCount: 1, targetLabel: "target" });
  });

  it("treats malformed or absent arrays as zero valid items", () => {
    expect(describeCompressionRequest("range", { content: "nope" })).toEqual({
      topic: "Untitled compression",
      targetCount: 0,
      targetLabel: "range",
    });
    expect(describeCompressionRequest("message", { targets: [{ messageId: "m1" }] })).toEqual({
      topic: "Untitled compression",
      targetCount: 0,
      targetLabel: "target",
    });
  });
});

describe("requestCompressionApproval", () => {
  it("confirms in TUI with the topic and pluralized range count", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { ctx } = ctxFor({ confirm });

    const result = await requestCompressionApproval(
      "range",
      {
        topic: "database migrations",
        content: [
          { startId: "m1", endId: "m4", summary: "a" },
          { startId: "m5", endId: "m8", summary: "b" },
        ],
      },
      ctx,
    );

    expect(result).toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
    const [title, message] = confirm.mock.calls[0] as [string, string];
    expect(title).toBe("Allow DCP compression?");
    expect(message).toContain("database migrations");
    expect(message).toContain("2 ranges");
  });

  it("uses a singular target label in message mode", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { ctx } = ctxFor({ confirm });

    await requestCompressionApproval(
      "message",
      { topic: "one", targets: [{ messageId: "m1", summary: "a" }] },
      ctx,
    );

    const [, message] = confirm.mock.calls[0] as [string, string];
    expect(message).toContain("1 target");
    expect(message).not.toContain("1 targets");
  });

  it("confirms in RPC mode with dialog UI", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const { ctx } = ctxFor({ mode: "rpc", hasUI: true, confirm });

    await expect(
      requestCompressionApproval("range", { content: [] }, ctx),
    ).resolves.toBeUndefined();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("reports a rejected confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(false);
    const { ctx } = ctxFor({ confirm });

    await expect(requestCompressionApproval("range", {}, ctx)).resolves.toBe(
      "Compression was not approved",
    );
  });

  it("reports a cancelled confirmation", async () => {
    const confirm = vi.fn().mockResolvedValue(undefined);
    const { ctx } = ctxFor({ confirm });

    await expect(requestCompressionApproval("range", {}, ctx)).resolves.toBe(
      "Compression was not approved",
    );
  });

  it("reports a thrown confirmation", async () => {
    const confirm = vi.fn().mockRejectedValue(new Error("boom"));
    const { ctx } = ctxFor({ confirm });

    await expect(requestCompressionApproval("range", {}, ctx)).resolves.toBe(
      "Compression was not approved",
    );
  });

  it("fails closed without dialog UI in print and JSON modes", async () => {
    for (const mode of ["print", "json"] as const) {
      const confirm = vi.fn();
      const { ctx } = ctxFor({ mode, hasUI: false, confirm });

      await expect(requestCompressionApproval("range", {}, ctx)).resolves.toBe(
        "Compression requires interactive approval",
      );
      expect(confirm).not.toHaveBeenCalled();
    }
  });

  it("fails closed in TUI when dialog UI is unavailable", async () => {
    const confirm = vi.fn();
    const { ctx } = ctxFor({ mode: "tui", hasUI: false, confirm });

    await expect(requestCompressionApproval("range", {}, ctx)).resolves.toBe(
      "Compression requires interactive approval",
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it("passes the call signal to the dialog", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const controller = new AbortController();
    const { ctx } = ctxFor({ confirm });

    await requestCompressionApproval("range", {}, ctx, controller.signal);

    expect(confirm).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      signal: controller.signal,
    });
  });

  it("falls back to the context signal when no call signal is provided", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const controller = new AbortController();
    const { ctx } = ctxFor({ confirm, signal: controller.signal });

    await requestCompressionApproval("range", {}, ctx);

    expect(confirm).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      signal: controller.signal,
    });
  });
});
