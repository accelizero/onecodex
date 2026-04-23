import * as fs from "fs";
import * as path from "path";

export class Journal {
  constructor(
    private readonly filePath: string,
    private readonly scope: string,
  ) {}

  info(message: string): void {
    this.write("INFO", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  private write(level: string, message: string): void {
    const line = `[${new Date().toISOString()}] [${level}] [${this.scope}] ${message}\n`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, line, "utf8");
    } catch {}
    try {
      process.stderr.write(line);
    } catch {}
  }
}
