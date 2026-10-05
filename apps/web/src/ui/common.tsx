import type { ReactNode } from 'react';
import { t } from '../i18n';

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

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([k, l]) => <button key={k} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
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
const COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8', '#fff176'];

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
