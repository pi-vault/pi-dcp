import { posix } from "node:path";

/** Glob matching and tool/file path protection for pruning strategies. */
export function matchesGlob(input: string, pattern: string): boolean {
  try {
    return posix.matchesGlob(input, pattern);
  } catch {
    return false;
  }
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
