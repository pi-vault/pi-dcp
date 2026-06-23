import * as fs from "node:fs/promises";

/**
 * Parse a child sub-agent session .jsonl file and extract assistant message text.
 * Returns concatenated assistant text.
 */
export async function parseChildSessionResults(sessionFilePath: string): Promise<string> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const assistantTexts: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message") continue;
        if (entry.message?.role !== "assistant") continue;

        const text = extractText(entry.message.content);
        if (text.trim()) assistantTexts.push(text);
      } catch {
        // Skip malformed lines
      }
    }

    return assistantTexts.join("\n\n");
  } catch {
    return "";
  }
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (p): p is { type: string; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as Record<string, unknown>).type === "text" &&
        typeof (p as Record<string, unknown>).text === "string",
    )
    .map((p) => p.text)
    .join("\n");
}
