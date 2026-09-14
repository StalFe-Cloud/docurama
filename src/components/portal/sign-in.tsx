"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, setSessionToken } from "@/lib/client";
import { BrandLogo, BRAND_LEGAL_NAME, BRAND_ADDRESS } from "@/components/brand/logo";

const DEMO_ACCOUNTS = [
  {
    label: "Platform Admin — Docurama SAS",
    email: "admin@docurama.eu",
    password: "admin1234",
    desc: "Full admin control panel: tenants, compliance, billing, ops",
  },
  {
    label: "Workspace Admin — Northwind Logistics",
    email: "alex@northwind.example",
    password: "demo1234",
    desc: "Enterprise user portal: documents, templates, settings",
  },
];

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const queryClient = useQueryClient();

  const login = useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(creds),
      }).then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean; error?: string; token?: string;
        };
        if (!res.ok) throw new ApiError(body.error ?? `Sign-in failed (HTTP ${res.status})`, res.status);
        return body;
      }),
    onSuccess: (body) => {
      // Persist the bearer fallback token so the session survives embedding
      // contexts where the browser blocks third-party cookies entirely.
      if (body?.token) setSessionToken(body.token);
      queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success("Welcome back");
    },
    onError: (err: ApiError) => {
      toast.error(err.message || "Sign-in failed");
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password });
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-nautical p-10 text-white lg:flex">
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/30 blur-3xl" aria-hidden />
        <div className="absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-[#4fd1a1]/15 blur-3xl" aria-hidden />
        <div className="relative">
          <BrandLogo invert tagline size="md" />
        </div>
        <div className="relative max-w-md space-y-5">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            The enterprise portal for signed, sealed and verifiable documents.
          </h1>
          <p className="text-sm leading-relaxed text-white/70">
            PAdES digital signatures with honest conformance reporting, RFC 3161 timestamps,
            GDPR-grade compliance operations and full platform administration — in one console.
          </p>
          <ul className="space-y-2.5 text-sm text-white/80">
            {[
              "Cryptographic verification with copyable evidence digests",
              "Tenant, plan and lifecycle administration for the whole platform",
              "DSAR, retention, legal hold and audit chain operations built-in",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">
          © 2026 {BRAND_LEGAL_NAME} · {BRAND_ADDRESS} · EU data residency · eIDAS &amp; ESIGN compliant workflows
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center p-6">
        <main className="w-full max-w-md space-y-8">
          <div className="space-y-2 text-center lg:text-left">
            <div className="mb-6 flex justify-center lg:justify-start">
              <BrandLogo tagline size="md" className="lg:hidden" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Sign in to your portal</h2>
            <p className="text-sm text-muted-foreground">
              Platform administrators and workspace members use the same door.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email" type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password" type="password" autoComplete="current-password" required value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Signing in…</>
              ) : (
                <><Lock className="h-4 w-4" aria-hidden /> Sign in securely</>
              )}
            </Button>
            {login.isError && (
              <p role="alert" className="text-sm text-destructive">
                {(login.error as ApiError)?.message ?? "Sign-in failed — please try again."}
              </p>
            )}
          </form>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Demo accounts — one click to enter
            </p>
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setEmail(acc.email);
                  setPassword(acc.password);
                  login.mutate({ email: acc.email, password: acc.password });
                }}
                className="w-full rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary-soft/40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="block text-sm font-medium">{acc.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{acc.desc}</span>
                <span className="mt-2 block font-mono text-xs text-muted-foreground">{acc.email} · {acc.password}</span>
              </button>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
