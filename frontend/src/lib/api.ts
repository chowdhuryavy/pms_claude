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

// Calls go to /api/pms on this site (api/pms.js forwards them to Apps Script), so no CORS header is needed.
const API_URL = '/api/pms';

export async function callApi<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
  idempotencyKey?: string
): Promise<T> {
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
    throw new ApiError(
      'NETWORK',
      'Cannot reach the server. Check your connection. If it persists, the Apps Script web app may not be shared with "Anyone".'
    );
  }
  let body: { ok: boolean; data?: T; error?: { code: string; message: string } };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // Usually a Google sign-in page: the web app is not shared with "Anyone".
    throw new ApiError(
      'BAD_RESPONSE',
      'The server did not return data. Check that the Apps Script web app is deployed with access set to "Anyone".'
    );
  }
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
