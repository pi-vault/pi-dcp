import { describe, expect, it } from "vitest";
import {
  createToolSignature,
  normalizeParams,
} from "../src/strategies/deduplication.ts";

describe("deduplication utilities", () => {
  describe("createToolSignature", () => {
    it("creates deterministic signature", () => {
      const sig1 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      const sig2 = createToolSignature("read", { filePath: "/tmp/a.ts" });
      expect(sig1).toBe(sig2);
    });

    it("normalizes key order", () => {
      const sig1 = createToolSignature("edit", {
        filePath: "a",
        content: "b",
      });
      const sig2 = createToolSignature("edit", {
        content: "b",
        filePath: "a",
      });
      expect(sig1).toBe(sig2);
    });

    it("strips null/undefined values", () => {
      const sig1 = createToolSignature("read", { filePath: "a" });
      const sig2 = createToolSignature("read", {
        filePath: "a",
        extra: null,
      });
      expect(sig1).toBe(sig2);
    });
  });

  describe("normalizeParams", () => {
    it("returns undefined for null", () => {
      expect(normalizeParams(null)).toBeUndefined();
    });

    it("returns undefined for undefined", () => {
      expect(normalizeParams(undefined)).toBeUndefined();
    });

    it("passes through primitives", () => {
      expect(normalizeParams("hello")).toBe("hello");
      expect(normalizeParams(42)).toBe(42);
      expect(normalizeParams(true)).toBe(true);
    });

    it("recursively normalizes arrays", () => {
      expect(normalizeParams([{ b: 2, a: 1 }])).toEqual([{ a: 1, b: 2 }]);
    });

    it("sorts object keys and strips undefined values", () => {
      expect(normalizeParams({ z: 1, a: 2, m: undefined })).toEqual({
        a: 2,
        z: 1,
      });
    });
  });
});
