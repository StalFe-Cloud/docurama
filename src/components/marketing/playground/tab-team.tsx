"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEAT_LIMIT, initials, type Member } from "./data";
import { usePlayground } from "./store";

export function TeamTab() {
  const { state, invite } = usePlayground();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("Member");
  const [error, setError] = useState<string | null>(null);
  const used = state.team.length;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) { setError("Enter a valid work email."); return; }
    if (state.team.some((m) => m.email === value)) { setError("This person is already on the team."); return; }
    if (used >= SEAT_LIMIT) { setError(`All ${SEAT_LIMIT} Starter seats are taken. Business adds 7 more seats. Recipients never need a seat.`); return; }
    const local = value.split("@")[0].replace(/[._-]+/g, " ");
    invite({ name: local.replace(/\b\w/g, (c) => c.toUpperCase()), email: value, role, status: "Invited" });
    setEmail(""); setError(null);
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">Team</p>
          <p className="mt-1 text-xs text-muted-foreground">Seats are for senders. Signers and people in copy never need an account.</p>
        </div>
        <p className="shrink-0 text-xs"><span className="font-semibold">{used}</span> <span className="text-muted-foreground">of {SEAT_LIMIT} seats</span></p>
      </div>

      <ul className="divide-y rounded-xl border">
        {state.team.map((m) => (
          <li key={m.email} className="flex items-center gap-3 px-3 py-2.5 motion-safe:animate-in motion-safe:fade-in">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{initials(m.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{m.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{m.email}</span>
            </span>
            <span className="text-[11px] text-muted-foreground">{m.role}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", m.status === "Active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>{m.status}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={submit} className="space-y-2">
        <p className="text-xs font-medium">Invite a teammate</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Work email</span>
            <input value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="name@stalfe.example" type="email"
              className="h-9 w-full rounded-lg border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-invalid={!!error} aria-describedby="team-error" />
          </label>
          <label>
            <span className="sr-only">Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as Member["role"])}
              className="h-9 w-full rounded-lg border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-28">
              <option>Member</option><option>Admin</option>
            </select>
          </label>
          <button type="submit" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground active:scale-[0.98]">
            <UserPlus className="h-3.5 w-3.5" aria-hidden /> Invite
          </button>
        </div>
        <p id="team-error" role={error ? "alert" : undefined} className={cn("text-[11px]", error ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
          {error ?? "Invitations are single-use links that expire after 7 days."}
        </p>
      </form>
    </div>
  );
}
