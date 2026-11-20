import type { Me } from './hooks';

/** Sends the user to the first portal their grants allow. */
export function landingFor(me: Me): string {
  if (me.user.must_change_password) return 'password.html';
  const fns = Object.keys(me.grants);
  if (me.is_system_admin || fns.some((f) => f.startsWith('ADMIN.'))) return 'admin.html';
  if (fns.some((f) => f.startsWith('RES.') || f.startsWith('FO.'))) return 'frontdesk.html';
  if (fns.some((f) => f.startsWith('CASH.'))) return 'cashier.html';
  if (fns.some((f) => f.startsWith('AUDIT.') || f.startsWith('RPT.'))) return 'audit.html';
  if (fns.some((f) => f.startsWith('CFG.'))) return 'property.html';
  return 'index.html';
}
