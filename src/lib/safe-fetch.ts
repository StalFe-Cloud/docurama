/**
 * Binary HTTP for trust-service protocols: RFC 3161 timestamps, OCSP, CRLs and
 * CA certificates (AIA "caIssuers").
 *
 * Every destination goes through the webhook SSRF policy (public addresses
 * only, one DNS resolution pinned for the connection, no redirects, a total
 * deadline and a size cap). Plain HTTP is admitted: these protocols carry
 * signed objects that are checked after download, and most CAs publish them
 * over HTTP only. URLs can come from certificates a customer imported, which
 * is exactly why none of them is trusted with an unguarded request.
 */
import http from "node:http";
import https from "node:https";
import { pinnedLookup, resolveWebhookTarget } from "@/lib/safe-webhook-http";

export class SafeFetchError extends Error {}

export async function safeFetchBytes(rawUrl: string, opts: {
  method?: "GET" | "POST";
  body?: Buffer;
  contentType?: string;
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
  /** Prefix for error messages, e.g. "TSA" or "OCSP responder". */
  label?: string;
} = {}): Promise<Buffer> {
  const label = opts.label ?? "Remote service";
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  let target: Awaited<ReturnType<typeof resolveWebhookTarget>>;
  try {
    target = await resolveWebhookTarget(rawUrl, signal, { plainHttp: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/^Webhook (endpoints|destination|URLs)/, `${label} URLs`) : String(error);
    throw new SafeFetchError(`${label} URL not allowed: ${reason}`);
  }
  return new Promise((resolve, reject) => {
    const request = (target.url.protocol === "https:" ? https : http).request(target.url, {
      method: opts.method ?? (opts.body ? "POST" : "GET"), agent: false, family: target.family, signal,
      lookup: pinnedLookup(target),
      headers: {
        Host: target.url.host,
        ...(opts.accept ? { Accept: opts.accept } : {}),
        ...(opts.body ? { "Content-Type": opts.contentType ?? "application/octet-stream", "Content-Length": opts.body.length } : {}),
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new SafeFetchError(`${label} answered HTTP ${status}`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) { response.destroy(); reject(new SafeFetchError(`${label} reply is too large`)); return; }
        chunks.push(chunk);
      });
      response.once("end", () => resolve(Buffer.concat(chunks)));
      response.once("error", reject);
    });
    request.once("error", reject);
    request.end(opts.body);
  });
}
