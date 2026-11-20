/**
 * Session token storage. sessionStorage keeps the token per browser tab and clears
 * it when the tab closes. The token is never stored in localStorage or a cookie.
 */
const KEY = 'pms.session';

export function getToken(): string | null {
  return sessionStorage.getItem(KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(KEY);
}
