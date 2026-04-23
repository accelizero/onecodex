import * as http from "http";
import { StationSettings } from "../domain/contracts";

export class CodexRpcClient {
  constructor(private readonly resolveAddress: () => string) {}

  async synchronize(settings: StationSettings): Promise<void> {
    if (settings.apiKey) {
      await this.invoke("loginApiKey", { apiKey: settings.apiKey });
    }

    if (settings.model) {
      try {
        await this.invoke("setDefaultModel", { model: settings.model });
      } catch {}
    }
  }

  async invoke(method: string, params: Record<string, unknown>): Promise<void> {
    const payload = JSON.stringify({ method, params });

    await new Promise<void>((resolve, reject) => {
      const request = http.request(
        `${this.resolveAddress()}/codex-api/rpc`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8").trim();
            if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
              resolve();
              return;
            }
            reject(new Error(body || `${method} failed with status ${String(response.statusCode ?? 0)}`));
          });
        },
      );

      request.on("error", reject);
      request.write(payload);
      request.end();
    });
  }
}
