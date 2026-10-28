"use client";

/**
 * Portal API client.
 *
 * Original platform: fetch against Next.js API routes. This port runs
 * without a backend, so requests are answered by the client-side demo store
 * (src/lib/demo-store.ts) behind the same function surface. Every response
 * is checked BEFORE parsing, so failed mutations can never be reported as
 * successes.
 */

import { demoRequest, DemoError } from "@/lib/demo-store";

// Route every /api/* fetch through the demo store, including the raw
// fetch() calls in ported components that bypass this client.
if (typeof window !== "undefined" && !(window as unknown as { __docuramaDemoFetch?: boolean }).__docuramaDemoFetch) {
  (window as unknown as { __docuramaDemoFetch?: boolean }).__docuramaDemoFetch = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
    if (path.startsWith("/api/")) {
      let body: unknown;
      if (typeof init?.body === "string") {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = undefined;
        }
      }
      try {
        const data = await demoRequest(init?.method ?? "GET", path, body);
        return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
      } catch (err) {
        const status = err instanceof DemoError ? err.status : 500;
        const message = err instanceof Error ? err.message : "Request failed";
        return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
      }
    }
    return original(input, init);
  };
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** localStorage key for the bearer session token. */
export const SESSION_TOKEN_STORE = "docurama_token";

/** Persist the bearer token returned by a successful sign-in. */
export function setSessionToken(token: string) {
  try {
    window.localStorage.setItem(SESSION_TOKEN_STORE, token);
  } catch {
    // Storage unavailable (private mode).
  }
}

/** Drop the bearer token (sign-out). */
export function clearSessionToken() {
  try {
    window.localStorage.removeItem(SESSION_TOKEN_STORE);
  } catch {
    // Ignore - nothing to clean up.
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return (await demoRequest(method, path, body)) as T;
  } catch (err) {
    if (err instanceof DemoError) throw new ApiError(err.message, err.status);
    throw err;
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return call<T>("GET", path);
}

export async function apiPost<T>(path: string, body: { op: string; id?: string; data?: Record<string, unknown> }): Promise<T> {
  return call<T>("POST", path, body);
}

/** POST an arbitrary JSON body (non-settings routes: billing checkout, etc.). */
export async function apiJsonPost<T>(path: string, body: unknown): Promise<T> {
  return call<T>("POST", path, body);
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const file = formData.get("file");
  return call<T>("POST", path, { fileName: file instanceof File ? file.name : "document.pdf" });
}
