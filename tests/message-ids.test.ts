import { describe, expect, it } from "vitest";
import {
  formatMessageRef,
  formatBlockRef,
  parseMessageRef,
  parseBlockRef,
  parseBoundaryId,
  formatMessageIdTag,
} from "../src/utils/message-ids.ts";

describe("message-ids", () => {
  describe("formatMessageRef", () => {
    it("zero-pads to 4 digits", () => {
      expect(formatMessageRef(1)).toBe("m0001");
      expect(formatMessageRef(42)).toBe("m0042");
      expect(formatMessageRef(9999)).toBe("m9999");
    });
  });

  describe("formatBlockRef", () => {
    it("formats block IDs", () => {
      expect(formatBlockRef(1)).toBe("b1");
      expect(formatBlockRef(123)).toBe("b123");
    });
  });

  describe("parseMessageRef", () => {
    it("parses valid message refs", () => {
      expect(parseMessageRef("m0001")).toBe(1);
      expect(parseMessageRef("m0042")).toBe(42);
    });

    it("returns undefined for invalid refs", () => {
      expect(parseMessageRef("b1")).toBeUndefined();
      expect(parseMessageRef("abc")).toBeUndefined();
      expect(parseMessageRef("m00001")).toBeUndefined();
    });
  });

  describe("parseBlockRef", () => {
    it("parses valid block refs", () => {
      expect(parseBlockRef("b1")).toBe(1);
      expect(parseBlockRef("b42")).toBe(42);
    });

    it("returns undefined for invalid refs", () => {
      expect(parseBlockRef("m0001")).toBeUndefined();
      expect(parseBlockRef("bx")).toBeUndefined();
    });
  });

  describe("parseBoundaryId", () => {
    it("parses message boundaries", () => {
      const result = parseBoundaryId("m0001");
      expect(result).toEqual({ type: "message", index: 1 });
    });

    it("parses block boundaries", () => {
      const result = parseBoundaryId("b3");
      expect(result).toEqual({ type: "block", blockId: 3 });
    });

    it("returns undefined for invalid", () => {
      expect(parseBoundaryId("xyz")).toBeUndefined();
    });
  });

  describe("formatMessageIdTag", () => {
    it("formats basic tag", () => {
      expect(formatMessageIdTag("m0001")).toBe(
        "<dcp-message-id>m0001</dcp-message-id>",
      );
    });

    it("formats tag with priority", () => {
      expect(formatMessageIdTag("m0001", { priority: 3 })).toBe(
        '<dcp-message-id priority="3">m0001</dcp-message-id>',
      );
    });
  });
});
