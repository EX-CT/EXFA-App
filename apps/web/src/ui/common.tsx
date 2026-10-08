import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '../i18n';

/** Item icon from CCP's image CDN (images.evetech.net, no auth). Ships/structures get the
 * 3D render endpoint, everything else the icon endpoint. The API only serves the fixed
 * sizes 32/64/128/256/512 (anything else is HTTP 400), so we request the smallest size
 * that covers `size` and let CSS scale it down. Lazy-loaded; hidden on 404. */
const iconSize = (size: number) => (size <= 32 ? 32 : size <= 64 ? 64 : size <= 128 ? 128 : size <= 256 ? 256 : 512);
export function TypeIcon({ id, size = 32, render = false }: { id: number; size?: number; render?: boolean }) {
  return <img className="typeicon" width={size} height={size} loading="lazy" alt="" draggable={false}
    src={`https://images.evetech.net/types/${id}/${render ? 'render' : 'icon'}?size=${iconSize(size)}`}
    onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }} />;
}

export const fmt = (v: number | null | undefined, d = 1): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'b';
  if (a >= 1e6) return (v / 1e6).toFixed(2) + 'm';
  if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k';
  return v.toFixed(d);
};
export const pctFmt = (v: number | null | undefined) => (v == null ? '—' : (v * 100).toFixed(1) + '%');

/** Series names are English keys, optionally prefixed with "<fit name>: "; translate the key part. */
export const seriesLabel = (n: string) => { const i = n.lastIndexOf(': '); return i < 0 ? t(n) : n.slice(0, i + 2) + t(n.slice(i + 2)); };

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}{right && <span className="right">{right}</span>}</h3>
      {children}
    </section>
  );
}

/** Floating right-click menu shell. Outside-close listeners attach one tick after mount so the
 *  gesture that opened the menu (and its trailing click/auxclick in some browsers) can't close it.
 *  Native context menu is suppressed globally in main.tsx. */
export function FloatMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const close = () => onClose();
    const id = setTimeout(() => { window.addEventListener('mousedown', close); window.addEventListener('contextmenu', close); }, 0);
    return () => { clearTimeout(id); window.removeEventListener('mousedown', close); window.removeEventListener('contextmenu', close); };
  }, [onClose]);
  return (
    <div className="ctxmenu" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([k, l]) => <button key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function InlineEdit({ value, onCommit, placeholder, className = '', autoEdit = false }: {
  value: string; onCommit: (value: string) => void; placeholder?: string; className?: string;
  /** Mount straight into the input (inline "new X" rows in trees). */
  autoEdit?: boolean;
}) {
  const [editing, setEditing] = useState(autoEdit);
  const [draft, setDraft] = useState(value);
  const original = useRef(value);
  const finished = useRef(false);
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (commit && draft.trim() !== original.current) onCommit(draft.trim());
  };
  useEffect(() => {
    if (!editing) { setDraft(value); original.current = value; }
  }, [editing, value]);
  return editing
    ? <input className={`inline-edit-input ${className}`} autoFocus value={draft} placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); e.currentTarget.blur(); } if (e.key === 'Escape') { e.preventDefault(); finish(false); e.currentTarget.blur(); } }}
        onBlur={() => finish(true)} />
    : <button type="button" className={`inline-edit ${className}`} aria-label={placeholder ?? value} onClick={() => { finished.current = false; setEditing(true); }}>{value || placeholder}</button>;
}

export function Popover({ open, onClose, children, className = '' }: {
  open: boolean; onClose: () => void; children: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open, onClose]);
  return open ? <div ref={ref} className={`popover ${className}`} role="dialog">{children}</div> : null;
}

export function Bar({ used, total, label }: { used: number; total: number; label: string }) {
  const p = total > 0 ? Math.min(used / total, 1.5) : used > 0 ? 1.5 : 0;
  return (
    <div className={'bar' + (used > total + 1e-9 ? ' over' : '')} title={`${label}: ${fmt(used, 2)} / ${fmt(total, 2)}`}>
      <span className="fill" style={{ width: `${Math.min(p, 1) * 100}%` }} />
      <span className="lbl">{label}</span>
      <span className="val">{fmt(used, 1)} / {fmt(total, 1)}</span>
    </div>
  );
}

export interface ChartSeries { name: string; points: [number, number][]; dash?: string; color?: number }
const COLORS = ['#d9a640', '#f2c96b', '#5fbf77', '#e5484d', '#7aa7d9', '#f0883e'];

export function LineChart({ series, xLabel, yLabel, height = 260 }: { series: ChartSeries[]; xLabel: string; yLabel: string; height?: number }) {
  const W = 640, H = height, L = 56, B = 34, R = 12, T = 10;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div className="muted">{t('No data for this graph.')}</div>;
  const xmax = Math.max(...all.map((p) => p[0])) || 1, xmin = Math.min(0, ...all.map((p) => p[0]));
  const ymax = Math.max(...all.map((p) => p[1]).filter(Number.isFinite)) * 1.05 || 1;
  const sx = (x: number) => L + ((x - xmin) / (xmax - xmin)) * (W - L - R);
  const sy = (y: number) => H - B - (Math.min(y, ymax) / ymax) * (H - B - T);
  const ticks = (max: number, min = 0) => Array.from({ length: 6 }, (_, i) => min + ((max - min) * i) / 5);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} vs ${xLabel}`}>
      {ticks(ymax).map((y) => <g key={'y' + y}><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className="grid" /><text x={L - 4} y={sy(y) + 4} textAnchor="end">{fmt(y, ymax < 10 ? 2 : 0)}</text></g>)}
      {ticks(xmax, xmin).map((x) => <g key={'x' + x}><line y1={T} y2={H - B} x1={sx(x)} x2={sx(x)} className="grid" /><text x={sx(x)} y={H - B + 14} textAnchor="middle">{fmt(x, xmax < 10 ? 1 : 0)}</text></g>)}
      <text x={(W + L) / 2} y={H - 4} textAnchor="middle" className="axis">{xLabel}</text>
      <text x={12} y={H / 2} textAnchor="middle" className="axis" transform={`rotate(-90 12 ${H / 2})`}>{yLabel}</text>
      {series.map((s, i) => (
        <polyline key={s.name} fill="none" stroke={COLORS[(s.color ?? i) % COLORS.length]} strokeWidth={2} strokeDasharray={s.dash}
          points={s.points.filter((p) => Number.isFinite(p[1])).map((p) => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')} />
      ))}
      {series.map((s, i) => <text key={'l' + s.name} x={W - R - 4} y={T + 14 + i * 14} textAnchor="end" fill={COLORS[(s.color ?? i) % COLORS.length]}>{s.dash ? '┄ ' : ''}{seriesLabel(s.name)}</text>)}
    </svg>
  );
}
