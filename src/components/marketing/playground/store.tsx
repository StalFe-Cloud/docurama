"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import {
  SEED_ENVELOPES, SEED_TEAM, YOU, newCode, nowLabel,
  type Channel, type Envelope, type Member, type Signer, type TabKey, type ThreadItem,
} from "./data";

export interface Delivery { id: string; event: string; code: string; status: 200; at: string }

interface State {
  tab: TabKey;
  envelopes: Envelope[];
  selectedId: string;
  team: Member[];
  deliveries: Delivery[];
  /** Envelope the Signing tab works on (latest one sent from the builder, else a seed). */
  signingId: string;
  /** Title handed from Templates to the Builder. */
  builderTitle: string;
  /** Code handed to the Verify tab (auto-verifies on arrival). */
  verifyCode: string | null;
  lastSealedCode: string | null;
}

type Action =
  | { type: "tab"; tab: TabKey }
  | { type: "select"; id: string }
  | { type: "append"; id: string; item: ThreadItem; patch?: (env: Envelope) => Envelope }
  | { type: "create"; envelope: Envelope }
  | { type: "sign"; id: string; signerIndex: number; at: string }
  | { type: "invite"; member: Member }
  | { type: "deliver"; delivery: Delivery }
  | { type: "builderTitle"; title: string }
  | { type: "verify"; code: string | null };

let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "tab":
      return { ...state, tab: action.tab };
    case "select":
      return {
        ...state, selectedId: action.id,
        envelopes: state.envelopes.map((e) => (e.id === action.id ? { ...e, unread: false } : e)),
      };
    case "append":
      return {
        ...state,
        envelopes: state.envelopes.map((e) => {
          if (e.id !== action.id) return e;
          const next = { ...e, thread: [...e.thread, action.item] };
          return action.patch ? action.patch(next) : next;
        }),
      };
    case "create":
      return {
        ...state,
        envelopes: [action.envelope, ...state.envelopes],
        selectedId: action.envelope.id,
        signingId: action.envelope.id,
      };
    case "sign": {
      let sealedCode: string | null = state.lastSealedCode;
      const envelopes = state.envelopes.map((e) => {
        if (e.id !== action.id) return e;
        const signers = e.signers.map((s, i) => (i === action.signerIndex ? { ...s, status: "SIGNED" as const, signedAt: action.at } : s));
        const done = signers.every((s) => s.status === "SIGNED");
        if (done) sealedCode = e.code;
        const signer = signers[action.signerIndex];
        const thread: ThreadItem[] = [
          ...e.thread,
          { id: uid("t"), kind: "event", actor: signer.name, text: `${signer.name} signed`, at: action.at },
          ...(done ? [{ id: uid("t"), kind: "event" as const, actor: "Docurama", text: "Sealed with an RFC 3161 timestamp. Evidence pack ready", at: action.at }] : []),
        ];
        return { ...e, signers, thread, status: done ? "COMPLETED" as const : "PARTIALLY_SIGNED" as const };
      });
      return { ...state, envelopes, lastSealedCode: sealedCode };
    }
    case "invite":
      return { ...state, team: [...state.team, action.member] };
    case "deliver":
      return { ...state, deliveries: [action.delivery, ...state.deliveries].slice(0, 8) };
    case "builderTitle":
      return { ...state, builderTitle: action.title };
    case "verify":
      return { ...state, verifyCode: action.code };
  }
}

interface Api {
  state: State;
  setTab: (tab: TabKey) => void;
  select: (id: string) => void;
  /** Reminder (out) or internal note; reminders get a scripted signer reaction. */
  post: (id: string, kind: "out" | "note", text: string, channel: Channel) => void;
  create: (input: { title: string; pages: number; signers: Omit<Signer, "status">[]; via?: "builder" | "api" }) => Envelope;
  sign: (id: string, signerIndex: number) => void;
  invite: (member: Member) => void;
  applyTemplate: (title: string) => void;
  verify: (code: string) => void;
  clearVerify: () => void;
}

const Ctx = createContext<Api | null>(null);

export function usePlayground(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error("usePlayground outside PlaygroundProvider");
  return api;
}

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => ({
    tab: "documents",
    envelopes: SEED_ENVELOPES,
    selectedId: SEED_ENVELOPES[0].id,
    team: SEED_TEAM,
    deliveries: [
      { id: "d0", event: "envelope.completed", code: "DOC-2HV5N8", status: 200, at: "Mon" },
    ],
    signingId: SEED_ENVELOPES[1].id,
    builderTitle: "Distribution agreement, Nordlicht",
    verifyCode: null,
    lastSealedCode: null,
  }));

  // Scripted reactions are timers; clear them all when the demo unmounts.
  const timers = useRef<number[]>([]);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const envelopesRef = useRef(state.envelopes);
  useEffect(() => { envelopesRef.current = state.envelopes; }, [state.envelopes]);

  const deliver = useCallback((event: string, code: string) => {
    dispatch({ type: "deliver", delivery: { id: uid("d"), event, code, status: 200, at: nowLabel() } });
  }, []);

  const api = useMemo<Api>(() => ({
    state,
    setTab: (tab) => dispatch({ type: "tab", tab }),
    select: (id) => dispatch({ type: "select", id }),
    post: (id, kind, text, channel) => {
      dispatch({ type: "append", id, item: { id: uid("t"), kind, actor: YOU, text, at: nowLabel(), channel } });
      if (kind !== "out") return;
      const env = envelopesRef.current.find((e) => e.id === id);
      const signer = env?.signers.find((s) => s.status !== "SIGNED");
      if (!env || !signer || env.status === "COMPLETED" || env.status === "DECLINED") return;
      const first = signer.name.split(" ")[0];
      later(1200, () => dispatch({ type: "append", id, item: { id: uid("t"), kind: "event", actor: signer.name, text: `${signer.name} opened your reminder`, at: nowLabel() } }));
      if (env.script === "view") return;
      if (env.script === "reply") {
        later(2600, () => dispatch({ type: "append", id, item: {
          id: uid("t"), kind: "in", actor: signer.name, at: nowLabel(),
          text: `Hi, ${first} here. Got it, I will sign it this afternoon.`,
        } }));
        return;
      }
      later(2400, () => dispatch({ type: "append", id, item: {
        id: uid("t"), kind: "in", actor: signer.name, at: nowLabel(),
        text: "All clear on our side, signing now.",
      } }));
      later(3800, () => {
        const index = env.signers.findIndex((s) => s.status !== "SIGNED");
        dispatch({ type: "sign", id, signerIndex: index, at: nowLabel() });
        deliver("envelope.signed", env.code);
        if (env.signers.filter((s) => s.status !== "SIGNED").length === 1) deliver("envelope.completed", env.code);
      });
    },
    create: ({ title, pages, signers, via = "builder" }) => {
      const envelope: Envelope = {
        id: uid("e"), code: newCode(), title, pages, status: "SENT", unread: false, script: "sign",
        signers: signers.map((s) => ({ ...s, status: "PENDING" })),
        thread: [{
          id: uid("t"), kind: "event", actor: YOU, at: nowLabel(),
          text: `${via === "api" ? "Created through the API and sent" : "Sent"} to ${signers.map((s) => s.name).join(" and ")}${signers.length > 1 ? " in routing order" : ""}`,
        }],
      };
      dispatch({ type: "create", envelope });
      deliver("envelope.sent", envelope.code);
      return envelope;
    },
    sign: (id, signerIndex) => {
      const env = envelopesRef.current.find((e) => e.id === id);
      dispatch({ type: "sign", id, signerIndex, at: nowLabel() });
      if (!env) return;
      deliver("envelope.signed", env.code);
      if (env.signers.filter((s) => s.status !== "SIGNED").length === 1) deliver("envelope.completed", env.code);
    },
    invite: (member) => dispatch({ type: "invite", member }),
    applyTemplate: (title) => { dispatch({ type: "builderTitle", title }); dispatch({ type: "tab", tab: "builder" }); },
    verify: (code) => { dispatch({ type: "verify", code }); dispatch({ type: "tab", tab: "verify" }); },
    clearVerify: () => dispatch({ type: "verify", code: null }),
  }), [state, later, deliver]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
