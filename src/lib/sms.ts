/** Outbound SMS for signer verification, riding the per-tenant gateway
 * configured in Settings → SMS (SmsGateway). Twilio and Vonage adapters are
 * implemented; other catalogued providers fail loudly until their adapters
 * land. Credentials never appear in logs or errors. */
import { db } from "@/lib/db";

export class SmsDeliveryError extends Error {}

type Gateway = {
  provider: string;
  apiKey: string | null;
  apiSecret: string | null;
  senderId: string;
  status: string;
};

const FETCH_TIMEOUT_MS = 10_000;

async function sendTwilio(gateway: Gateway, to: string, text: string): Promise<void> {
  // SimpleTwilio setup: apiKey = Account SID (AC…), apiSecret = Auth Token.
  const accountSid = gateway.apiKey ?? "";
  if (!/^AC[a-z0-9]{16,}$/i.test(accountSid) || !gateway.apiSecret) {
    throw new SmsDeliveryError("Twilio requires the Account SID (AC…) as the API key and the Auth Token as the API secret.");
  }
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${Buffer.from(`${accountSid}:${gateway.apiSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: gateway.senderId, Body: text }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SmsDeliveryError(`Twilio is unreachable (${error instanceof Error ? error.name : "network error"}).`);
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { message?: string } | null;
    throw new SmsDeliveryError(`Twilio rejected the message${detail?.message ? `: ${detail.message}` : ` (HTTP ${response.status})`}.`);
  }
}

async function sendVonage(gateway: Gateway, to: string, text: string): Promise<void> {
  if (!gateway.apiKey || !gateway.apiSecret) {
    throw new SmsDeliveryError("Vonage requires the API key and API secret.");
  }
  let response: Response;
  try {
    response = await fetch("https://rest.nexmo.com/sms/json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        api_key: gateway.apiKey, api_secret: gateway.apiSecret,
        from: gateway.senderId, to: to.replace(/^\+/, ""), text,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SmsDeliveryError(`Vonage is unreachable (${error instanceof Error ? error.name : "network error"}).`);
  }
  const payload = await response.json().catch(() => null) as { messages?: Array<{ status?: string; "error-text"?: string }> } | null;
  const first = payload?.messages?.[0];
  if (!response.ok || !first || first.status !== "0") {
    throw new SmsDeliveryError(`Vonage rejected the message${first?.["error-text"] ? `: ${first["error-text"]}` : ` (HTTP ${response.status})`}.`);
  }
}

const ADAPTERS: Record<string, (gateway: Gateway, to: string, text: string) => Promise<void>> = {
  twilio: sendTwilio,
  vonage: sendVonage,
};

export const SUPPORTED_SMS_PROVIDERS = Object.keys(ADAPTERS);

export function smsGatewayReady(gateway: Gateway | null): boolean {
  return Boolean(gateway && gateway.status !== "not_configured" && gateway.apiKey && ADAPTERS[gateway.provider]);
}

/** Send a signer verification code through the tenant's configured gateway. */
export async function sendSmsThroughGateway(
  tenantId: string,
  to: string,
  code: string,
  name: string,
  envelopeTitle: string,
): Promise<void> {
  const gateway = await db.smsGateway.findUnique({ where: { tenantId } });
  if (!smsGatewayReady(gateway)) {
    throw new SmsDeliveryError("SMS verification is not available: no SMS gateway is configured for this workspace.");
  }
  const text = `Docurama: your verification code for "${envelopeTitle}" is ${code}. It expires in 10 minutes. Never share this code.`;
  try {
    await ADAPTERS[gateway!.provider]({ ...gateway!, senderId: gateway!.senderId || "DOCURAMA" }, to, text);
  } catch (error) {
    if (error instanceof SmsDeliveryError) throw error;
    throw new SmsDeliveryError("The SMS gateway rejected the message. Contact the sender.");
  }
}
