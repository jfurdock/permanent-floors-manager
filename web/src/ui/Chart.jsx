// Single-series bar chart drawn to one scale, with a hover/tap readout.
import { useEffect, useRef, useState } from 'react';

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function BarChart({ data, format = (v) => String(v), height = 220, label = 'Bar chart', highlightLast = true }) {
  const [hover, setHover] = useState(null);
  const box = useRef(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const padL = 48;
  const padR = 8;
  const padT = 22;
  const padB = 28;
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const slot = innerW / Math.max(1, data.length);
  const bw = Math.max(6, Math.min(44, slot * 0.6));
  const y = (v) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const active = hover ?? (highlightLast ? data.length - 1 : null);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="axis" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text className="tick" x={padL - 8} y={y(t) + 4} textAnchor="end">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          const top = y(d.value);
          const h = Math.max(0, padT + innerH - top);
          const r = Math.min(4, h / 2, bw / 2);
          const path = h > 0
            ? `M ${cx - bw / 2} ${padT + innerH} V ${top + r} Q ${cx - bw / 2} ${top} ${cx - bw / 2 + r} ${top} H ${cx + bw / 2 - r} Q ${cx + bw / 2} ${top} ${cx + bw / 2} ${top + r} V ${padT + innerH} Z`
            : '';
          return (
            <g key={d.label}>
              {h > 0 && <path d={path} className={i === active ? 'bar-hi' : 'bar'} />}
              <text className="tick" x={cx} y={height - 8} textAnchor="middle">{d.short || d.label}</text>
              {i === active && <text className="val" x={cx} y={Math.max(12, top - 6)} textAnchor="middle">{format(d.value)}</text>}
              <rect x={padL + slot * i} y={padT} width={slot} height={innerH} fill="transparent"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onClick={() => setHover(i)}>
                <title>{`${d.label}: ${format(d.value)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Meter({ value, max }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <div className="meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>;
}
