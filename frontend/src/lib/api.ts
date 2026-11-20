/**
 * Client for the Apps Script API. Every call is a POST with a JSON body sent as
 * text/plain, which avoids a CORS preflight. The server is the only authority on
 * access. The UI hides buttons for convenience, and the API refuses the call anyway.
 */
import { getToken, clearToken } from './session';

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export async function callApi<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
  idempotencyKey?: string
): Promise<T> {
  if (!API_URL) {
    throw new ApiError('CONFIG', 'VITE_API_URL is not set. Copy .env.example to .env.local.');
  }
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        token: getToken(),
        payload,
        idempotency_key: idempotencyKey
      })
    });
  } catch {
    throw new ApiError('NETWORK', 'Cannot reach the server. Check your connection and try again.');
  }
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { code: string; message: string } };
  if (!body.ok) {
    const code = body.error?.code ?? 'UNKNOWN';
    if (code === 'UNAUTHENTICATED') clearToken();
    throw new ApiError(code, body.error?.message ?? 'Request failed');
  }
  return body.data as T;
}

/** Fresh key per user action. A double-click or retry reuses it only if the caller passes the same key. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
