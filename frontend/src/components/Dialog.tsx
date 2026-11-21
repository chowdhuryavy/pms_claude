import { useState, type ReactNode } from 'react';
import { Button } from './ui';
import { Icon } from './Icon';

export interface AskOptions { title?: string; message: string; okLabel?: string; danger?: boolean }

/**
 * Styled replacement for the browser's confirm box. Use it in a component like this:
 *   const [dialog, ask] = useConfirm();
 *   if (await ask({ message: '...' })) { ... }
 * and render {dialog} somewhere inside the component.
 */
export function useConfirm(): [ReactNode, (options: AskOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<(AskOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const ask = (options: AskOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const node = pending ? (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" role="dialog" aria-modal="true"
      onClick={() => answer(false)}>
      <div className="anim-pop w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${pending.danger ? 'bg-rose-100 text-rose-600' : 'bg-sky-100 text-sky-600'}`}>
            <Icon name={pending.danger ? 'alert' : 'info'} size={20} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-slate-900">{pending.title ?? 'Please confirm'}</h3>
            <p className="mt-1 text-sm text-slate-600">{pending.message}</p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => answer(false)}>Cancel</Button>
          <Button variant={pending.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>{pending.okLabel ?? 'Confirm'}</Button>
        </div>
      </div>
    </div>
  ) : null;

  return [node, ask];
}
