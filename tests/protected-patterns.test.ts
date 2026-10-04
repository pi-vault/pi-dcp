import { describe, expect, it } from "vitest";
import {
  matchesGlob,
  isToolNameProtected,
  getFilePathsFromParameters,
  isFilePathProtected,
} from "../src/strategies/protected-patterns.ts";

describe("protected-patterns", () => {
  describe("matchesGlob", () => {
    it("matches exact strings", () => {
      expect(matchesGlob("bash", "bash")).toBe(true);
      expect(matchesGlob("bash", "read")).toBe(false);
    });

    it("matches * wildcard", () => {
      expect(matchesGlob("test_foo", "test_*")).toBe(true);
      expect(matchesGlob("other", "test_*")).toBe(false);
    });

    it("matches ** for paths", () => {
      expect(matchesGlob("src/foo/bar.ts", "src/**/*.ts")).toBe(true);
      expect(matchesGlob("src/foo/bar.js", "src/**/*.ts")).toBe(false);
    });

    it("matches ? single char", () => {
      expect(matchesGlob("ab", "a?")).toBe(true);
      expect(matchesGlob("abc", "a?")).toBe(false);
    });

    it("matches character classes using Node glob semantics", () => {
      expect(matchesGlob("testa.ts", "test[abc].ts")).toBe(true);
      expect(matchesGlob("testz.ts", "test[abc].ts")).toBe(false);
      expect(matchesGlob("file7.ts", "file[0-9].ts")).toBe(true);
    });

    it("preserves slash separators independently of the host OS", () => {
      expect(matchesGlob("src/config.ts", "src/**/*.ts")).toBe(true);
      expect(matchesGlob("src\\config.ts", "src/**/*.ts")).toBe(false);
    });

    it("preserves regex punctuation as literal path text", () => {
      expect(matchesGlob("src/a+b.ts", "src/a+b.ts")).toBe(true);
      expect(matchesGlob("src/ab.ts", "src/a+b.ts")).toBe(false);
    });

    it("returns false for malformed patterns", () => {
      expect(matchesGlob("[", "[")).toBe(false);
      expect(matchesGlob("src/[abc.ts", "src/[abc.ts")).toBe(false);
      expect(matchesGlob("testa.ts", "test[abc.ts")).toBe(false);
      expect(matchesGlob("foo", "[")).toBe(false);
    });

    it("preserves wildcard matching of leading-dot segments", () => {
      expect(matchesGlob(".env", "*")).toBe(true);
      expect(matchesGlob("src/.env", "src/**/*")).toBe(true);
      expect(matchesGlob(".git/config", "**/*")).toBe(true);
    });
  });

  describe("isToolNameProtected", () => {
    it("checks exact match", () => {
      expect(isToolNameProtected("bash", ["bash", "read"])).toBe(true);
      expect(isToolNameProtected("write", ["bash", "read"])).toBe(false);
    });

    it("checks glob patterns", () => {
      expect(isToolNameProtected("todo_write", ["todo*"])).toBe(true);
      expect(isToolNameProtected("other", ["todo*"])).toBe(false);
    });

    it("evaluates character-class patterns without star or question mark", () => {
      expect(isToolNameProtected("read", ["r[ea]ad"])).toBe(true);
      expect(isToolNameProtected("write", ["r[ea]ad"])).toBe(false);
    });

    it("returns false for empty patterns", () => {
      expect(isToolNameProtected("bash", [])).toBe(false);
    });
  });

  describe("getFilePathsFromParameters", () => {
    it("extracts filePath from standard tools", () => {
      const paths = getFilePathsFromParameters("read", {
        filePath: "/tmp/foo.ts",
      });
      expect(paths).toEqual(["/tmp/foo.ts"]);
    });

    it("extracts Pi-native path for read, write, and edit", () => {
      expect(getFilePathsFromParameters("read", { path: "src/secret.ts" })).toEqual([
        "src/secret.ts",
      ]);
      expect(getFilePathsFromParameters("write", { path: "src/secret.ts" })).toEqual([
        "src/secret.ts",
      ]);
      expect(getFilePathsFromParameters("edit", { path: "src/secret.ts" })).toEqual([
        "src/secret.ts",
      ]);
    });

    it("normalizes Windows separators in Pi-native paths", () => {
      expect(getFilePathsFromParameters("edit", { path: "src\\secret.ts" })).toEqual([
        "src/secret.ts",
      ]);
    });

    it("accepts legacy filePath for every tool", () => {
      expect(getFilePathsFromParameters("legacy-tool", { filePath: "legacy/file.ts" })).toEqual([
        "legacy/file.ts",
      ]);
    });

    it("ignores a generic path on non-file tools", () => {
      expect(getFilePathsFromParameters("custom-tool", { path: "not-a-file-selector" })).toEqual(
        [],
      );
    });

    it("processes path before filePath and drops empty or duplicate values", () => {
      expect(
        getFilePathsFromParameters("read", {
          path: "src/a.ts",
          filePath: "src/b.ts",
        }),
      ).toEqual(["src/a.ts", "src/b.ts"]);
      expect(
        getFilePathsFromParameters("read", {
          path: "src/a.ts",
          filePath: "src\\a.ts",
        }),
      ).toEqual(["src/a.ts"]);
      expect(getFilePathsFromParameters("read", { path: "", filePath: "" })).toEqual([]);
    });

    it("returns empty for tools without file paths", () => {
      const paths = getFilePathsFromParameters("bash", { command: "ls" });
      expect(paths).toEqual([]);
    });
  });

  describe("isFilePathProtected", () => {
    it("matches file paths against glob patterns", () => {
      expect(isFilePathProtected(["src/config.ts"], ["src/**/*.ts"])).toBe(true);
      expect(isFilePathProtected(["lib/foo.ts"], ["src/**/*.ts"])).toBe(false);
    });

    it("matches file paths against character-class patterns", () => {
      expect(isFilePathProtected(["src/a.ts"], ["src/[ab].ts"])).toBe(true);
      expect(isFilePathProtected(["src/c.ts"], ["src/[ab].ts"])).toBe(false);
    });

    it("returns false for empty paths or patterns", () => {
      expect(isFilePathProtected([], ["src/**"])).toBe(false);
      expect(isFilePathProtected(["/tmp/a"], [])).toBe(false);
    });

    it("normalizes candidate separators without changing glob semantics", () => {
      expect(matchesGlob("src\\config.ts", "src/**/*.ts")).toBe(false);
      expect(isFilePathProtected(["src\\config.ts"], ["src/**/*.ts"])).toBe(true);
    });
  });
});
