import { NextRequest } from "next/server";
import { db } from "@/lib/db";

/**
 * A workspace logo, by the SHA-256 of its bytes (Settings > Personalization).
 * Public: emails and signing pages show it to recipients without an account.
 * Content-addressed, so a new logo gets a new URL and this one can be cached
 * for good.
 */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ hash: string }> }) {
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new Response("Not found", { status: 404 });
  const p = await db.personalization.findFirst({ where: { logoSha256: hash }, select: { logo: true } });
  const m = p?.logo ? /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(p.logo) : null;
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), {
    headers: {
      "content-type": m[1],
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
