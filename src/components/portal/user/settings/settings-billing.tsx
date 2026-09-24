"use client";

/**
 * Settings → Billing. Everything money: current plan, allowance and seats,
 * the plan/term picker (Stripe Checkout when the instance has Stripe
 * configured; bank-transfer + admin approval otherwise), payment history
 * and the customer-portal entry point.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowUpRight, BadgeCheck, Banknote, CalendarClock, CheckCircle2, CreditCard,
  History, Loader2, MailWarning, Receipt, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError, apiGet, apiJsonPost } from "@/lib/client";
import { ErrorState } from "@/components/portal/shared";
import { BILLING_TERMS, PLAN_CATALOG, PLAN_ORDER, planDef, planPriceLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";

type Overview = {
  mode: "stripe" | "manual";
  plan: {
    code: string; name: string; custom: boolean; monthlyEur: number; seatLimit: number;
    envelopeLimit: number; bestFor: string; features: string[]; outcomes: string[];
  };
  trial: { endsAt: string } | null;
  billingBlock: { reason: string; message: string } | null;
  subscription: {
    status: string; termMonths: number; discountPct: number; renewalAt: string;
    paymentMethod: string; provider: string; failedPayment: boolean; carriedForwardEnvelopes: number;
  } | null;
  allowance: { limit: number; carriedForward: number; total: number; used: number; remaining: number };
  seats: { seatLimit: number; members: number; pendingInvites: number; used: number; remaining: number };
  payments: {
    id: string; provider: string; kind: string; planCode: string; termMonths: number;
    amountCents: number; currency: string; status: string; reference: string | null;
    description: string; checkoutUrl: string | null; createdAt: string; paidAt: string | null;
  }[];
};

// Derived from the catalog so the labels can never drift from what is charged.
const TERMS = BILLING_TERMS.map((t) => ({
  months: t.months,
  label: t.months === 1 ? "Monthly — no engagement" : `${t.label} (−${t.discountPct}%)`,
}));

const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;

export function BillingTab() {
  const queryClient = useQueryClient();
  const [planChoice, setPlanChoice] = useState("");
  const [termChoice, setTermChoice] = useState("1");
  const [manualResult, setManualResult] = useState<{ reference: string; amountEur: string; instructions?: string } | null>(null);
  // Back from Stripe Checkout: the webhook activates the plan within seconds,
  // so poll the overview briefly instead of showing the old plan as if nothing happened.
  // Read once on mount; the tab only renders its content client-side after data loads.
  const [returnedFromCheckout] = useState<"success" | "canceled" | null>(() => {
    if (typeof window === "undefined") return null;
    const outcome = new URLSearchParams(window.location.search).get("checkout");
    return outcome === "success" || outcome === "canceled" ? outcome : null;
  });
  useEffect(() => {
    if (!returnedFromCheckout) return;
    if (returnedFromCheckout === "canceled") toast.info("Checkout canceled — nothing was charged.");
    window.history.replaceState(null, "", window.location.pathname);
  }, [returnedFromCheckout]);

  const { data, isError, error, isLoading, refetch } = useQuery({
    queryKey: ["billing", "overview"],
    queryFn: () => apiGet<Overview>("/api/billing/overview"),
    staleTime: 10_000,
    refetchInterval: (query) => {
      if (returnedFromCheckout !== "success") return false;
      const pending = query.state.data?.payments.some((p) => p.provider === "stripe" && p.status === "PENDING");
      return pending && query.state.dataUpdateCount < 20 ? 3_000 : false;
    },
  });

  // Derived default: the current plan until the user picks another.
  const planSelection = planChoice || data?.plan.code || "";

  const checkout = useMutation({
    mutationFn: (vars: { planCode: string; termMonths: number }) =>
      apiJsonPost<{ mode: string; url?: string; reference: string; amountEur: string; instructions?: string }>("/api/billing/checkout", vars),
    onSuccess: (res) => {
      if (res.mode === "stripe" && res.url) {
        window.location.href = res.url;
        return;
      }
      setManualResult({ reference: res.reference, amountEur: res.amountEur, instructions: res.instructions });
      queryClient.invalidateQueries({ queryKey: ["billing", "overview"] });
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  const portal = useMutation({
    mutationFn: () => apiJsonPost<{ url: string }>("/api/billing/portal", {}),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (err: ApiError) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="flex min-h-40 items-center justify-center" role="status" aria-label="Loading billing">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState message={(error as Error)?.message ?? "Billing unavailable"} onRetry={() => refetch()} />;
  }

  const pendingManual = data.payments.find((p) => p.status === "PENDING" && p.provider === "manual");
  const activatingStripe = returnedFromCheckout === "success" && data.payments.some((p) => p.provider === "stripe" && p.status === "PENDING");
  // Re-buying the exact plan and term already paid for is the only no-op choice.
  const alreadyPaidChoice = Boolean(data.subscription && ["ACTIVE", "PAST_DUE"].includes(data.subscription.status) &&
    planSelection === data.plan.code && Number(termChoice) === data.subscription.termMonths);
  const allowancePct = data.allowance.total > 0 ? Math.min(100, Math.round((data.allowance.used / data.allowance.total) * 100)) : 0;
  const seatsPct = data.seats.seatLimit > 0 ? Math.min(100, Math.round((data.seats.used / data.seats.seatLimit) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Status banners */}
      {returnedFromCheckout === "success" && (
        <div className="flex items-start gap-3 rounded-xl border border-success/40 bg-success-soft/40 p-4" role="status">
          {activatingStripe
            ? <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-success" aria-hidden />
            : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />}
          <div className="text-sm">
            <p className="font-semibold">{activatingStripe ? "Payment received — activating your plan…" : "Your plan is active"}</p>
            <p className="mt-1 text-muted-foreground">
              {activatingStripe
                ? "This usually takes a few seconds. Bank debits (SEPA) can take a few days to confirm; we email you when the plan is active."
                : "Thank you! Your receipt is on its way by email, and invoices are available under Manage payment method & invoices."}
            </p>
          </div>
        </div>
      )}
      {data.billingBlock && data.subscription?.status !== "PAST_DUE" && (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">{data.billingBlock.reason === "payment_required" ? `Activate your ${data.plan.name} plan` : "Sending is paused"}</p>
            <p className="mt-1 text-muted-foreground">{data.billingBlock.message} Existing envelopes can still be signed and verified.</p>
          </div>
        </div>
      )}
      {data.subscription?.status === "PAST_DUE" && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4" role="alert">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-destructive">Payment failed — action needed</p>
            <p className="mt-1 text-muted-foreground">
              The last charge for this workspace failed. {data.mode === "stripe" ? "Update your payment method below, then we retry automatically." : "Contact billing@docurama.eu to settle the open invoice."}
              {data.billingBlock?.reason === "past_due" && " Sending new envelopes is paused until the payment succeeds."}
            </p>
          </div>
        </div>
      )}
      {pendingManual && (
        <div className="flex items-start gap-3 rounded-xl border border-info/40 bg-info-soft/40 p-4">
          <Banknote className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Bank transfer pending confirmation</p>
            <p className="mt-1 text-muted-foreground">
              Reference <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{pendingManual.reference}</code> · {eur(pendingManual.amountCents)} —
              quote this reference on your transfer. Your plan activates as soon as billing confirms it.
            </p>
          </div>
        </div>
      )}
      {data.trial && (
        <div className="flex items-start gap-3 rounded-xl border border-primary/40 bg-primary-soft/40 p-4">
          <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">You&apos;re on a trial</p>
            <p className="mt-1 text-muted-foreground">
              Trial ends {new Date(data.trial.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}. Pick a plan below to keep every feature — your envelopes and templates stay exactly as they are.
            </p>
          </div>
        </div>
      )}

      {/* Current plan + usage */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current plan</p>
                <h3 className="mt-1 text-xl font-semibold">{data.plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{data.plan.bestFor}</p>
              </div>
              <div className="text-right">
                {data.plan.custom && !data.plan.monthlyEur
                  ? <p className="text-2xl font-semibold">Custom</p>
                  : <p className="text-2xl font-semibold">€{data.plan.monthlyEur}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>}
                {data.subscription && data.subscription.discountPct > 0 && (
                  <p className="text-xs text-muted-foreground">−{data.subscription.discountPct}% term discount</p>
                )}
              </div>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Term</dt>
                <dd className="mt-0.5 font-medium">{data.subscription ? `${data.subscription.termMonths} month(s)` : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Renews</dt>
                <dd className="mt-0.5 font-medium">
                  {data.subscription ? new Date(data.subscription.renewalAt).toLocaleDateString("en-GB") : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Payment method</dt>
                <dd className="mt-0.5 font-medium">{data.subscription?.paymentMethod ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Status</dt>
                <dd className="mt-0.5 font-medium">{data.subscription?.status ?? (data.trial ? "TRIAL" : "—")}</dd>
              </div>
            </dl>
            <div className="mt-5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => portal.mutate()}
                disabled={portal.isPending}
              >
                {portal.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
                {data.mode === "stripe" ? "Manage payment method & invoices" : "Billing contact"}
              </Button>
              {data.mode === "manual" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  This instance handles payments out-of-band (bank transfer / SEPA). Invoices and cancellations: billing@docurama.eu.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usage this period</p>
            <div className="mt-4 space-y-5">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Envelopes</span>
                  <span className="text-muted-foreground">
                    {data.allowance.used} / {data.allowance.total}
                    {data.allowance.carriedForward > 0 && (
                      <span className="ml-1 text-xs">(+{data.allowance.carriedForward} rolled over)</span>
                    )}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={allowancePct} aria-valuemin={0} aria-valuemax={100} aria-label="Envelope allowance used">
                  <div className={cn("h-full rounded-full", allowancePct >= 90 ? "bg-warning" : "bg-primary")} style={{ width: `${allowancePct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {data.allowance.remaining} remaining · unused envelopes roll over on renewal (up to one monthly allowance)
                </p>
              </div>
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">Seats</span>
                  <span className="text-muted-foreground">
                    {data.seats.used} / {data.seats.seatLimit}
                    {data.seats.pendingInvites > 0 && <span className="ml-1 text-xs">({data.seats.pendingInvites} invited)</span>}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={seatsPct} aria-valuemin={0} aria-valuemax={100} aria-label="Seats used">
                  <div className={cn("h-full rounded-full", seatsPct >= 90 ? "bg-warning" : "bg-primary")} style={{ width: `${seatsPct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{data.seats.remaining} seats free — recipients never need a seat</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Plan / term picker */}
      <Card>
        <CardContent className="p-6">
          <p className="text-sm font-semibold">Change plan</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.mode === "stripe"
              ? "Checkout runs on Stripe — card, SEPA and Apple/Google Pay where available. Upgrades apply immediately; your allowance and rollover carry over."
              : "Pick a plan and term, then transfer the total with the generated reference. A billing admin confirms the transfer and your plan activates (usually one business day)."}
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="billing-plan">Plan</Label>
              <Select value={planSelection} onValueChange={setPlanChoice}>
                <SelectTrigger id="billing-plan" className="mt-1.5">
                  <SelectValue placeholder="Choose a plan" />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_ORDER.map((code) => (
                    <SelectItem key={code} value={code} disabled={code === "ENTERPRISE"}>
                      {code === "ENTERPRISE" ? "Enterprise — custom (via sales)" : data.plan.code === code ? `${labelFor(code)} — current` : labelFor(code)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="billing-term">Term</Label>
              <Select value={termChoice} onValueChange={setTermChoice}>
                <SelectTrigger id="billing-term" className="mt-1.5">
                  <SelectValue placeholder="Choose a term" />
                </SelectTrigger>
                <SelectContent>
                  {TERMS.map((t) => (
                    <SelectItem key={t.months} value={String(t.months)}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => checkout.mutate({ planCode: planSelection, termMonths: Number(termChoice) })}
              disabled={checkout.isPending || !planSelection || planSelection === "ENTERPRISE" || alreadyPaidChoice}
            >
              {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowUpRight className="h-4 w-4" aria-hidden />}
              {data.mode === "stripe" ? "Continue to checkout" : "Request activation"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Enterprise rollouts (SSO, BYO certificates, self-hosting) go through sales — <a className="underline underline-offset-2" href="/enterprise">talk to us</a>.
            </p>
          </div>

          {manualResult && (
            <div className="mt-4 rounded-xl border border-primary/40 bg-primary-soft/40 p-4" role="status">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <MailWarning className="h-4 w-4 text-primary" aria-hidden />
                Transfer {manualResult.amountEur} and quote this reference
              </p>
              <p className="mt-2 font-mono text-lg tracking-wide">{manualResult.reference}</p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{manualResult.instructions}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setManualResult(null)}>Close</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Payment history */}
      <Card>
        <CardContent className="p-6">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4 text-muted-foreground" aria-hidden />
            Payment history
          </p>
          {data.payments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No payments yet — your history will appear here after your first checkout.</p>
          ) : (
            <div className="docurama-scroll mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 pr-4 font-medium">Date</th>
                    <th scope="col" className="pb-2 pr-4 font-medium">Description</th>
                    <th scope="col" className="pb-2 pr-4 font-medium">Amount</th>
                    <th scope="col" className="pb-2 pr-4 font-medium">Provider</th>
                    <th scope="col" className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2.5 pr-4 whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString("en-GB")}</td>
                      <td className="py-2.5 pr-4">
                        {p.description}
                        {p.reference && <code className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{p.reference}</code>}
                      </td>
                      <td className="py-2.5 pr-4 whitespace-nowrap font-medium">{eur(p.amountCents)}</td>
                      <td className="py-2.5 pr-4 capitalize">{p.provider}</td>
                      <td className="py-2.5">
                        <span className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                          p.status === "PAID" && "bg-success-soft text-success",
                          p.status === "PENDING" && "bg-info-soft text-info",
                          (p.status === "FAILED" || p.status === "CANCELED") && "bg-destructive/10 text-destructive",
                        )}>
                          {p.status === "PAID" && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" aria-hidden />
            Every payment is ledger-recorded; receipts are emailed and archived with your workspace audit trail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function labelFor(code: string): string {
  if (!(code in PLAN_CATALOG)) return code;
  const plan = planDef(code);
  return `${plan.name} — ${planPriceLabel(plan)}`;
}

// Re-exported for the tab registry's icon.
export const BillingTabIcon = BadgeCheck;
