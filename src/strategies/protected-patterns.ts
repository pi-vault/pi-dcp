/**
 * Glob matching and tool/file path protection for pruning strategies.
 *
 * Custom glob implementation (no external dependency) supporting:
 * - `*` matches any chars except `/`
 * - `**` matches any chars including `/`
 * - `?` matches single char except `/`
 */

export function matchesGlob(input: string, pattern: string): boolean {
  return globToRegex(pattern).test(input);
}

function globToRegex(pattern: string): RegExp {
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
        i += 1;
      }
    } else if (c === "?") {
      result += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(c)) {
      result += "\\" + c;
      i += 1;
    } else {
      result += c;
      i += 1;
    }
  }
  result += "$";
  return new RegExp(result);
}

export function isToolNameProtected(
  toolName: string,
  protectedPatterns: string[],
): boolean {
  for (const pattern of protectedPatterns) {
    if (pattern === toolName) return true;
    if (pattern.includes("*") || pattern.includes("?")) {
      if (matchesGlob(toolName, pattern)) return true;
    }
  }
  return false;
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

export function isFilePathProtected(
  filePaths: string[],
  patterns: string[],
): boolean {
  if (filePaths.length === 0 || patterns.length === 0) return false;
  return filePaths.some((fp) => patterns.some((p) => matchesGlob(fp, p)));
}
