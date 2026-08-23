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

export function getFilePathsFromParameters(
  _toolName: string,
  parameters: Record<string, unknown>,
): string[] {
  const paths: string[] = [];
  if (typeof parameters.filePath === "string") {
    paths.push(parameters.filePath);
  }
  return paths;
}

export function isFilePathProtected(filePaths: string[], patterns: string[]): boolean {
  if (filePaths.length === 0 || patterns.length === 0) return false;
  return filePaths.some((fp) => patterns.some((p) => matchesGlob(fp, p)));
}
