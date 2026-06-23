import * as fs from "node:fs";
import * as path from "node:path";
import { DCP_SYSTEM_PROMPT } from "./system.ts";
import { CONTEXT_LIMIT_NUDGE, TURN_NUDGE, ITERATION_NUDGE } from "./nudges.ts";

export interface RuntimePrompts {
  system: string;
  contextLimitNudge: string;
  turnNudge: string;
  iterationNudge: string;
}

interface PromptStoreOptions {
  projectOverrideDir: string;
  globalOverrideDir: string;
}

const PROMPT_FILES: Record<keyof RuntimePrompts, string> = {
  system: "system.md",
  contextLimitNudge: "context-limit-nudge.md",
  turnNudge: "turn-nudge.md",
  iterationNudge: "iteration-nudge.md",
};

const BUNDLED_DEFAULTS: RuntimePrompts = {
  system: DCP_SYSTEM_PROMPT,
  contextLimitNudge: CONTEXT_LIMIT_NUDGE,
  turnNudge: TURN_NUDGE,
  iterationNudge: ITERATION_NUDGE,
};

const HTML_COMMENT_REGEX = /<!--[\s\S]*?-->/g;

/**
 * PromptStore manages override precedence for DCP prompts.
 * Precedence: project > global > bundled defaults.
 *
 * Only covers prompts injected at runtime (system prompt, nudge text).
 * The compress tool description is registered at extension load time
 * and is not overridable via this mechanism.
 */
export class PromptStore {
  private projectDir: string;
  private globalDir: string;
  private prompts: RuntimePrompts;

  constructor(options: PromptStoreOptions) {
    this.projectDir = options.projectOverrideDir;
    this.globalDir = options.globalOverrideDir;
    this.prompts = { ...BUNDLED_DEFAULTS };
  }

  /**
   * Re-read override files and rebuild runtime prompts.
   * Safe to call on every context pass (filesystem errors are swallowed).
   */
  reload(): void {
    const result = { ...BUNDLED_DEFAULTS };

    for (const [key, filename] of Object.entries(PROMPT_FILES)) {
      const override = this.loadOverride(filename);
      if (override !== undefined) {
        (result as Record<string, string>)[key] = override;
      }
    }

    this.prompts = result;
  }

  getRuntimePrompts(): RuntimePrompts {
    return this.prompts;
  }

  private loadOverride(filename: string): string | undefined {
    // Project overrides take precedence
    const projectFile = path.join(this.projectDir, filename);
    const projectContent = this.readAndNormalize(projectFile);
    if (projectContent !== undefined) return projectContent;

    // Fall back to global overrides
    const globalFile = path.join(this.globalDir, filename);
    return this.readAndNormalize(globalFile);
  }

  private readAndNormalize(filePath: string): string | undefined {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const normalized = raw.replace(HTML_COMMENT_REGEX, "").trim();
      if (!normalized) return undefined; // Empty files fall back to default
      return normalized;
    } catch {
      return undefined;
    }
  }
}

/**
 * Write bundled defaults to a directory for user reference.
 */
export function writeDefaultPrompts(targetDir: string): void {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const [key, filename] of Object.entries(PROMPT_FILES)) {
      const content = BUNDLED_DEFAULTS[key as keyof RuntimePrompts];
      const filePath = path.join(targetDir, filename);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content, "utf-8");
      }
    }
  } catch {
    // Non-fatal: defaults directory is just for reference
  }
}
