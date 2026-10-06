import { useEffect, useState } from 'react';
import { t } from '../i18n';

export type NoticeKind = 'error' | 'warn' | 'info' | 'ok';
export interface NoticeAction { label: string; onClick: () => void }
export interface NoticeInput { kind: NoticeKind; text: string; action?: NoticeAction; ms?: number }
interface Notice extends NoticeInput { id: number; ms: number }

let nextId = 1;

export function notify(input: NoticeInput) {
  if (typeof window === 'undefined') return;
  const notice: Notice = { ...input, id: nextId++, ms: input.ms ?? (input.kind === 'error' ? 6000 : 2500) };
  window.dispatchEvent(new CustomEvent<Notice>('exfa:notify', { detail: notice }));
}

function Toast({ notice, onDismiss }: { notice: Notice; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(notice.id), notice.ms);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);
  return (
    <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'} onClick={() => onDismiss(notice.id)}>
      <span>{notice.text}</span>
      {notice.action && <button onClick={(e) => { e.stopPropagation(); notice.action!.onClick(); onDismiss(notice.id); }}>{notice.action.label}</button>}
      <button className="toast-dismiss" aria-label={t('Dismiss notification')} onClick={(e) => { e.stopPropagation(); onDismiss(notice.id); }}>×</button>
    </div>
  );
}

export function ToastViewport() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const dismiss = (id: number) => setNotices((items) => items.filter((item) => item.id !== id));
  useEffect(() => {
    const receive = (event: Event) => setNotices((items) => [...items, (event as CustomEvent<Notice>).detail].slice(-4));
    window.addEventListener('exfa:notify', receive);
    return () => window.removeEventListener('exfa:notify', receive);
  }, []);
  return <div className="toast-viewport" aria-live="polite">{notices.map((notice) => <Toast key={notice.id} notice={notice} onDismiss={dismiss} />)}</div>;
}
