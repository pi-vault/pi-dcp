import * as fs from "node:fs";
import * as path from "node:path";

export class Logger {
  private enabled: boolean;
  private logDir: string | undefined;

  constructor(enabled: boolean, logDir?: string) {
    this.enabled = enabled;
    this.logDir = logDir;
  }

  info(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("INFO", source, message, data);
  }

  warn(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("WARN", source, message, data);
  }

  warnAlways(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("WARN", source, message, data, true);
  }

  error(source: string, message: string, data?: Record<string, unknown>): void {
    this.write("ERROR", source, message, data);
  }

  private write(
    level: string,
    source: string,
    message: string,
    data?: Record<string, unknown>,
    force = false,
  ): void {
    if ((!this.enabled && !force) || !this.logDir) return;

    const now = new Date();
    const timestamp = now.toISOString();
    const dateStr = timestamp.slice(0, 10);

    let line = `${timestamp} ${level.padEnd(5)} ${source}: ${message}`;
    if (data) {
      const pairs = Object.entries(data)
        .map(([k, v]) => `${k}=${typeof v === "string" ? `"${v}"` : String(v)}`)
        .join(" ");
      line += ` | ${pairs}`;
    }

    try {
      fs.mkdirSync(this.logDir, { recursive: true });
      fs.appendFileSync(path.join(this.logDir, `${dateStr}.log`), `${line}\n`);
    } catch {
      // Logging is best-effort and must never interrupt extension behavior.
      return;
    }
  }
}
