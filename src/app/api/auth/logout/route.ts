import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { jsonOk } from "@/lib/serializers";

export async function POST(req: NextRequest) {
  const res = jsonOk({ ok: true });

  // Always clear the session cookie (attribute-matched so the browser actually
  // deletes it). The client also drops its bearer token from localStorage —
  // see lib/client.ts clearSessionToken().
  const proto =
    req.headers.get("x-forwarded-proto") ??
    (req.url.startsWith("https:") ? "https" : "http");
  const isHttps = proto.split(",")[0].trim() === "https";
  const clearAttrs = isHttps
    ? "Path=/; HttpOnly; SameSite=None; Secure; Partitioned; Max-Age=0"
    : "Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; ${clearAttrs}`);
  return res;
}
