import { SESSION_COOKIE } from "@/lib/auth";
import { jsonOk } from "@/lib/serializers";

export async function POST() {
  const res = jsonOk({ ok: true });
  res.headers.append("set-cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return res;
}
