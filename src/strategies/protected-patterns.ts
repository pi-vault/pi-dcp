import { posix } from "node:path";

/** Glob matching and tool/file path protection for pruning strategies. */
export function matchesGlob(input: string, pattern: string): boolean {
  if (hasUnclosedCharacterClass(pattern)) return false;

  try {
    if (posix.matchesGlob(input, pattern)) return true;
  } catch {
    return false;
  }

  // Node's matcher excludes leading-dot segments from wildcards; preserve the
  // previous matcher contract without changing native class semantics.
  return matchesLegacyDotPath(input, pattern);
}

function hasUnclosedCharacterClass(pattern: string): boolean {
  let open = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") {
      i++;
    } else if (pattern[i] === "[") {
      open = true;
    } else if (pattern[i] === "]") {
      open = false;
    }
  }
  return open;
}

function matchesLegacyDotPath(input: string, pattern: string): boolean {
  if (!input.split("/").some((segment) => segment.startsWith("."))) return false;
  if (["[", "]", "{", "}", "\\"].some((character) => pattern.includes(character))) return false;

  let result = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          result += "(?:.*/)?";
          i += 3;
        } else {
          result += ".*";
          i += 2;
        }
      } else {
        result += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      result += "[^/]";
      i++;
    } else if ((".+^$" + "{}()|[]\\").includes(c)) {
      result += `\\${c}`;
      i++;
    } else {
      result += c;
      i++;
    }
  }

  return new RegExp(`${result}$`).test(input);
}

export function isToolNameProtected(toolName: string, protectedPatterns: string[]): boolean {
  return protectedPatterns.some((pattern) => matchesGlob(toolName, pattern));
}

const PI_FILE_PATH_TOOLS = new Set(["read", "write", "edit"]);

function normalizeFilePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function getFilePathsFromParameters(
  toolName: string,
  parameters: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  const pushPath = (value: unknown): void => {
    if (typeof value !== "string") return;
    const normalized = normalizeFilePath(value);
    if (normalized.length === 0 || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };

  if (PI_FILE_PATH_TOOLS.has(toolName)) {
    pushPath(parameters.path);
  }
  pushPath(parameters.filePath);

  return paths;
}

/**
 * Extract normalized file paths from a tool result's bounded nested-call record.
 * Accepts only a non-array record with a `calls` array; malformed records are ignored.
 */
export function getFilePathsFromNestedCalls(nestedCalls: unknown): string[] {
  if (typeof nestedCalls !== "object" || nestedCalls === null || Array.isArray(nestedCalls)) {
    return [];
  }

  const calls = (nestedCalls as Record<string, unknown>).calls;
  if (!Array.isArray(calls)) return [];

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    if (typeof call !== "object" || call === null || Array.isArray(call)) continue;
    const record = call as Record<string, unknown>;
    if (typeof record.name !== "string") continue;
    const args = record.arguments;
    if (typeof args !== "object" || args === null || Array.isArray(args)) continue;

    for (const path of getFilePathsFromParameters(record.name, args as Record<string, unknown>)) {
      if (seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

export function isFilePathProtected(filePaths: string[], patterns: string[]): boolean {
  if (filePaths.length === 0 || patterns.length === 0) return false;
  return filePaths.some((fp) => {
    const normalized = normalizeFilePath(fp);
    return patterns.some((p) => matchesGlob(normalized, p));
  });
}
