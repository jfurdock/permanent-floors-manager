// To-scale drawing of rooms. For roll goods it shows each drop of carpet, the seams,
// and the material that hangs past the wall (waste). Hard surfaces get a plank or tile pattern.
import { useId } from 'react';
import { formatFeet } from '@core/calc.js';

const W = 420;
const PAD_L = 30;
const PAD_R = 14;
const LABEL_H = 22;
const DIM_H = 18;
const GAP = 26;

function Plank({ x, y, w, h, s, tile }) {
  const lines = [];
  if (tile) {
    const step = 2 * s; // 12x24 tile
    for (let yy = y + s; yy < y + h - 0.5; yy += s) lines.push(<line key={`h${yy}`} className="plank" x1={x} y1={yy} x2={x + w} y2={yy} />);
    for (let xx = x + step; xx < x + w - 0.5; xx += step) lines.push(<line key={`v${xx}`} className="plank" x1={xx} y1={y} x2={xx} y2={y + h} />);
    return <g>{lines}</g>;
  }
  const pw = 0.6 * s; // ~7" planks
  const pl = 4 * s;
  let row = 0;
  for (let yy = y + pw; yy < y + h - 0.5; yy += pw, row += 1) {
    lines.push(<line key={`r${row}`} className="plank" x1={x} y1={yy} x2={x + w} y2={yy} />);
    const offset = (((row * 37) % 100) / 100) * pl;
    for (let xx = x + offset; xx < x + w; xx += pl) {
      if (xx > x + 1) lines.push(<line key={`j${row}-${xx}`} className="plank" x1={xx} y1={yy - pw} x2={xx} y2={yy} />);
    }
  }
  return <g>{lines}</g>;
}

export default function RoomDiagram({ rooms, layout, pattern = 'plain', title = 'Room diagram' }) {
  const uid = useId().replace(/:/g, '');
  const items = (layout ? layout.rooms : rooms.map((r) => ({ room: r })))
    .filter((it) => Number(it.room.length_ft) > 0 && Number(it.room.width_ft) > 0);
  if (!items.length) return null;
  const rw = layout?.rollWidth || 12;
  // Real extents including drops that hang past the walls
  const ext = items.map((it) => {
    const L = Number(it.room.length_ft);
    const Wd = Number(it.room.width_ft);
    if (!layout || !it.drops) return { L, Wd, ex: L, ey: Wd };
    return it.runsAlong === 'length' ? { L, Wd, ex: L, ey: Math.max(Wd, it.drops * rw) } : { L, Wd, ex: Math.max(L, it.drops * rw), ey: Wd };
  });
  const maxX = Math.max(...ext.map((e) => e.ex));
  const s = Math.min((W - PAD_L - PAD_R) / maxX, 16);
  let y = 0;
  const blocks = items.map((it, i) => {
    const { L, Wd, ex, ey } = ext[i];
    const top = y + LABEL_H + DIM_H;
    const x0 = PAD_L;
    const rw0 = L * s;
    const rh0 = Wd * s;
    const out = [];
    const clipId = `clip-${uid}-${i}`;
    out.push(<text key="n" className="name" x={x0} y={y + 14}>{it.room.name || `Room ${i + 1}`}</text>);
    // dimension along length (top)
    out.push(<line key="dl" className="dim-line" x1={x0} y1={top - 7} x2={x0 + rw0} y2={top - 7} />);
    out.push(<line key="dl1" className="dim-line" x1={x0} y1={top - 11} x2={x0} y2={top - 3} />);
    out.push(<line key="dl2" className="dim-line" x1={x0 + rw0} y1={top - 11} x2={x0 + rw0} y2={top - 3} />);
    out.push(<text key="dlt" className="dim" x={x0 + rw0 / 2} y={top - 10} textAnchor="middle">{formatFeet(L)}</text>);
    // dimension along width (left)
    out.push(<text key="dwt" className="dim" transform={`translate(${x0 - 9} ${top + rh0 / 2}) rotate(-90)`} textAnchor="middle">{formatFeet(Wd)}</text>);
    out.push(<rect key="floor" className="floor" x={x0} y={top} width={rw0} height={rh0} />);

    if (layout && it.drops) {
      out.push(<clipPath key="clip" id={clipId}><rect x={x0} y={top} width={rw0} height={rh0} /></clipPath>);
      const drops = [];
      const waste = [];
      const seams = [];
      const arrows = [];
      for (let d = 0; d < it.drops; d += 1) {
        const cls = d % 2 ? 'drop-b' : 'drop-a';
        if (it.runsAlong === 'length') {
          const dy = top + d * rw * s;
          drops.push(<rect key={`d${d}`} className={cls} x={x0} y={dy} width={rw0} height={rw * s} />);
          if ((d + 1) * rw > Wd + 1e-6) waste.push(<rect key={`w${d}`} className="waste" x={x0} y={top + rh0} width={rw0} height={((d + 1) * rw - Wd) * s} />);
          if (d > 0) seams.push(<line key={`s${d}`} className="seam" x1={x0} y1={dy} x2={x0 + rw0} y2={dy} />);
          const cy = dy + Math.min(rw, Wd - d * rw) * s / 2;
          arrows.push(<path key={`a${d}`} className="dim-line" fill="none" d={`M ${x0 + rw0 / 2 - 10} ${cy} h 20 m -6 -5 l 6 5 l -6 5`} />);
        } else {
          const dx = x0 + d * rw * s;
          drops.push(<rect key={`d${d}`} className={cls} x={dx} y={top} width={rw * s} height={rh0} />);
          if ((d + 1) * rw > L + 1e-6) waste.push(<rect key={`w${d}`} className="waste" x={x0 + rw0} y={top} width={((d + 1) * rw - L) * s} height={rh0} />);
          if (d > 0) seams.push(<line key={`s${d}`} className="seam" x1={dx} y1={top} x2={dx} y2={top + rh0} />);
          const cx = dx + Math.min(rw, L - d * rw) * s / 2;
          arrows.push(<path key={`a${d}`} className="dim-line" fill="none" d={`M ${cx} ${top + rh0 / 2 - 10} v 20 m -5 -6 l 5 6 l 5 -6`} />);
        }
      }
      out.push(<g key="drops" clipPath={`url(#${clipId})`}>{drops}</g>);
      out.push(<g key="waste">{waste}</g>);
      out.push(<rect key="outline" className="floor" fill="none" style={{ fill: 'none' }} x={x0} y={top} width={rw0} height={rh0} />);
      out.push(<g key="seams">{seams}</g>);
      out.push(<g key="arrows">{arrows}</g>);
      out.push(
        <text key="run" className="run" x={x0} y={top + ey * s + 15}>
          {`${it.drops} ${it.drops === 1 ? 'drop' : 'drops'} × ${formatFeet(it.cutLength)}`}
          {it.seams ? ` • ${it.seams} ${it.seams === 1 ? 'seam' : 'seams'}` : ' • no seams'}
        </text>,
      );
    } else if (pattern === 'plank' || pattern === 'tile') {
      out.push(<g key="pattern" clipPath={`url(#${clipId})`}><Plank x={x0} y={top} w={rw0} h={rh0} s={s} tile={pattern === 'tile'} /></g>);
      out.push(<clipPath key="clip" id={clipId}><rect x={x0} y={top} width={rw0} height={rh0} /></clipPath>);
      out.push(<rect key="outline" className="floor" style={{ fill: 'none' }} x={x0} y={top} width={rw0} height={rh0} />);
      out.push(<text key="area" className="run" x={x0} y={top + rh0 + 15}>{`${Math.round(L * Wd * 10) / 10} sq ft`}</text>);
    } else {
      out.push(<text key="area" className="run" x={x0} y={top + rh0 + 15}>{`${Math.round(L * Wd * 10) / 10} sq ft`}</text>);
    }
    const block = <g key={i}>{out}</g>;
    y = top + Math.max(ey, Wd) * s + 22 + GAP;
    return block;
  });
  const height = Math.max(60, y - GAP + 4);
  return (
    <svg className="room-diagram" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} preserveAspectRatio="xMinYMin meet">
      {blocks}
    </svg>
  );
}

export function DiagramLegend({ roll }) {
  if (!roll) return null;
  return (
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: 'var(--drop-a)' }} />Drop of carpet</span>
      <span><i style={{ background: 'transparent', borderTop: '2px dashed var(--seam)', height: 0 }} />Seam</span>
      <span><i style={{ background: 'var(--waste)', border: '1px dashed var(--seam)' }} />Hangs past the wall</span>
    </div>
  );
}
