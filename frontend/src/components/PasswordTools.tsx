import { Icon } from './Icon';
import { SecretInput } from './ui';

export interface PasswordCheck { id: string; label: string; ok: boolean }

/** Live rules for a new password. Matches the server policy in Admin.assertPasswordPolicy. */
export function checkPassword(next: string, confirm: string, current: string, minLength: number): PasswordCheck[] {
  return [
    { id: 'length', label: `At least ${minLength} characters`, ok: next.length >= minLength },
    { id: 'letter', label: 'Contains a letter', ok: /[A-Za-z]/.test(next) },
    { id: 'digit', label: 'Contains a digit', ok: /\d/.test(next) },
    { id: 'match', label: 'Matches the confirmation', ok: next.length > 0 && next === confirm },
    { id: 'different', label: 'Different from the current password', ok: next.length > 0 && next !== current }
  ];
}

/** Strength from 0 to 4, based on length and character variety. */
export function strengthOf(pwd: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pwd.length >= 12) score++;
  if (pwd.length >= 16) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++;
  const labels = [
    { label: 'Too weak', color: 'bg-red-500' }, { label: 'Weak', color: 'bg-orange-500' },
    { label: 'Fair', color: 'bg-amber-500' }, { label: 'Good', color: 'bg-lime-600' },
    { label: 'Strong', color: 'bg-green-600' }
  ];
  return { score, ...labels[score] };
}

export function PasswordRules({ checks, pwd }: { checks: PasswordCheck[]; pwd: string }) {
  const strength = strengthOf(pwd);
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-600">
          <span>Strength</span>
          <span className="font-medium transition-colors duration-300">{pwd ? strength.label : '—'}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full transition-all duration-500 ease-out ${pwd ? strength.color : ''}`}
            style={{ width: pwd ? `${(strength.score + 1) * 20}%` : '0%' }} />
        </div>
      </div>
      <ul className="space-y-1.5">
        {checks.map((c) => (
          <li key={c.id} className={`flex items-center gap-2 text-sm transition-colors duration-300 ${c.ok ? 'text-green-700' : 'text-slate-500'}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full transition-all duration-300 ${c.ok ? 'scale-100 bg-green-100' : 'scale-90 bg-slate-100'}`}>
              <Icon name={c.ok ? 'check' : 'x'} size={12} />
            </span>
            {c.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export { SecretInput };
