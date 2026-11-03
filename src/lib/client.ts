"use client";

/**
 * Portal API client.
 *
 * Connected to persistent server-side API routes (/api/*).
 * Sends authenticated requests with session credentials and Bearer token.
 */

import { demoRequest, DemoError } from "@/lib/demo-store";

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

function getStoredToken(): string | null {
  try {
    if (typeof window !== "undefined") {
      return window.localStorage.getItem(SESSION_TOKEN_STORE);
    }
  } catch {
    // Ignore
  }
  return null;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  const token = getStoredToken();
  if (token) {
    headers["authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "include",
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const message = (data && typeof data === "object" && "error" in data)
        ? String(data.error)
        : `Request failed with status ${res.status}`;
      throw new ApiError(message, res.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;

    // Graceful fallback to demo store if server is unreachable
    console.warn(`[API] Server unavailable for ${method} ${path}, checking fallback store...`, err);
    try {
      return (await demoRequest(method, path, body)) as T;
    } catch (demoErr) {
      if (demoErr instanceof DemoError) throw new ApiError(demoErr.message, demoErr.status);
      throw demoErr;
    }
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return call<T>("GET", path);
}

export async function apiPost<T>(
  path: string,
  body: { op: string; id?: string; data?: Record<string, unknown> },
): Promise<T> {
  return call<T>("POST", path, body);
}

/** POST an arbitrary JSON body (non-settings routes: billing checkout, etc.). */
export async function apiJsonPost<T>(path: string, body: unknown): Promise<T> {
  return call<T>("POST", path, body);
}

export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(path, {
      method: "POST",
      headers,
      body: formData,
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data?.error || "Upload failed", res.status);
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const file = formData.get("file");
    return call<T>("POST", path, { fileName: file instanceof File ? file.name : "document.pdf" });
  }
}
