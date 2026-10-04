import { describe, expect, it } from "vitest";
import {
  formatMessageRef,
  formatBlockRef,
  parseMessageRef,
  parseBlockRef,
  parseBoundaryId,
  formatMessageMarker,
  isCanonicalMessageRef,
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
      expect(parseMessageRef(formatMessageRef(10000))).toBe(10000);
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

    const acceptedMessageForms: Array<[string, number]> = [
      ["m1", 1],
      ["m0001", 1],
      ["@m1@", 1],
      ["@m1:3@", 1],
      ["m10000", 10000],
      ["@m10000:5@", 10000],
    ];

    it.each(acceptedMessageForms)("accepts message form %s", (input, index) => {
      expect(parseBoundaryId(input)).toEqual({ type: "message", index });
    });

    it("keeps block refs separate from compact message forms", () => {
      expect(parseBoundaryId("b3")).toEqual({ type: "block", blockId: 3 });
    });

    const rejectedForms = [
      "m0",
      "m0000",
      "m01",
      "m001",
      "m00001",
      "@m0@",
      "@m01@",
      "@m0001@",
      "@m00001@",
      "m-1",
      "m-0001",
      "m1.5",
      "m1e3",
      "@m-1@",
      "@m1.5@",
      "@m1:0@",
      "@m1:6@",
      "@m1:1.5@",
      "@m1:x@",
      "@m1",
      "m1@",
      "@m1:",
      "@m1:3",
      " m1",
      "m1 ",
      "\t@m1@\t",
      "\n@m1@",
      "M1",
      "M0001",
      "@M1@",
      "B1",
      "@m0@",
      "m9007199254740993",
      "@m9007199254740993@",
      "b9007199254740993",
      "b0",
      "",
    ];

    it.each(rejectedForms)("rejects %j", (input) => {
      expect(parseBoundaryId(input)).toBeUndefined();
    });
  });

  describe("formatMessageMarker", () => {
    it("emits a bare compact marker", () => {
      expect(formatMessageMarker("m0001")).toBe("@m1@");
    });

    it("emits a priority marker", () => {
      expect(formatMessageMarker("m0012", 3)).toBe("@m12:3@");
    });

    it("keeps high indices compact and unique", () => {
      expect(formatMessageMarker("m10000")).toBe("@m10000@");
      expect(formatMessageMarker("m10000")).not.toBe(formatMessageMarker("m1000"));
    });

    it("accepts every valid priority", () => {
      for (const priority of [1, 2, 3, 4, 5]) {
        expect(formatMessageMarker("m0001", priority)).toBe(`@m1:${priority}@`);
      }
    });

    it("throws for noncanonical refs", () => {
      expect(() => formatMessageMarker("m1")).toThrow(RangeError);
      expect(() => formatMessageMarker("@m1@")).toThrow(RangeError);
      expect(() => formatMessageMarker("m0000")).toThrow(RangeError);
      expect(() => formatMessageMarker("b1")).toThrow(RangeError);
    });

    it("throws for out-of-range or non-integer priorities", () => {
      expect(() => formatMessageMarker("m0001", 0)).toThrow(RangeError);
      expect(() => formatMessageMarker("m0001", 6)).toThrow(RangeError);
      expect(() => formatMessageMarker("m0001", 1.5)).toThrow(RangeError);
      expect(() => formatMessageMarker("m0001", -1)).toThrow(RangeError);
    });
  });

  describe("isCanonicalMessageRef", () => {
    it("accepts canonical padded refs only", () => {
      expect(isCanonicalMessageRef("m0001")).toBe(true);
      expect(isCanonicalMessageRef("m10000")).toBe(true);
      expect(isCanonicalMessageRef("m1")).toBe(false);
      expect(isCanonicalMessageRef("@m1@")).toBe(false);
      expect(isCanonicalMessageRef("m0000")).toBe(false);
      expect(isCanonicalMessageRef("m00001")).toBe(false);
    });
  });
});
