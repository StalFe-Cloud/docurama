import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";
import { jsonOk } from "@/lib/serializers";

export async function POST(req: NextRequest) {
  const res = jsonOk({ ok: true });

  // Clear the bearer token when the client asks for it (kept client-side in
  // localStorage — see lib/client.ts clearSessionToken()).
  if (req.headers.get("authorization")?.startsWith("Bearer ")) {
    return res;
  }

  // The removal attributes must match how the cookie was set (CHIPS over
  // HTTPS, Lax locally) so the browser actually deletes it.
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
