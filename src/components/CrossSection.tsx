import { useId } from 'react';
import { first, num, percent, translateEnum } from '../lib/settings';
import type { Settings } from '../lib/types';

/** Width of the top-down sample in mm. Keeps line widths visible. */
const W = 34, H = 22, R = 3;

type Dir = { angle: number; offset?: number };

function patternDirs(p: string): { dirs: Dir[]; kind: 'lines' | 'hex' | 'gyroid' | 'concentric' | 'lightning' | 'hilbert' | 'spiral'; known: boolean } {
  const k = p.toLowerCase().replace(/[\s_-]/g, '');
  if (['rectilinear', 'lines', 'line', 'monotonic', 'monotonicline', 'monotoniclines', 'alignedrectilinear', 'zigzag', 'crosszag', 'lockedzag'].includes(k))
    return { dirs: [{ angle: 0 }], kind: 'lines', known: true };
  if (['grid', 'crosshatch', 'cross', 'cross3d', '2dlattice'].includes(k)) return { dirs: [{ angle: 0 }, { angle: 90 }], kind: 'lines', known: true };
  if (['triangles', 'trihexagon'].includes(k)) return { dirs: [{ angle: 0 }, { angle: 60 }, { angle: 120 }], kind: 'lines', known: true };
  if (k === 'stars') return { dirs: [{ angle: 0 }, { angle: 60, offset: 0.5 }, { angle: 120, offset: 0.5 }], kind: 'lines', known: true };
  if (['cubic', 'adaptivecubic', 'supportcubic', 'quartercubic', 'tetrahedral', 'octet'].includes(k))
    return { dirs: [{ angle: 0, offset: 0.33 }, { angle: 60, offset: 0.66 }, { angle: 120 }], kind: 'lines', known: true };
  if (['honeycomb', '3dhoneycomb', 'lateralhoneycomb'].includes(k)) return { dirs: [], kind: 'hex', known: true };
  if (k === 'gyroid' || k === 'tpmsd' || k === 'tpmsfk') return { dirs: [], kind: 'gyroid', known: true };
  if (k.startsWith('concentric')) return { dirs: [], kind: 'concentric', known: true };
  if (k === 'lightning') return { dirs: [], kind: 'lightning', known: true };
  if (k === 'hilbertcurve') return { dirs: [], kind: 'hilbert', known: true };
  if (k === 'archimedeanchords' || k === 'octagramspiral') return { dirs: [], kind: 'spiral', known: true };
  return { dirs: [{ angle: 0 }, { angle: 90 }], kind: 'lines', known: false };
}

/** Distance between parallel infill lines so that the area coverage matches the density. */
function spacingFor(kind: string, dirs: number, lw: number, d: number) {
  const dd = Math.max(0.03, Math.min(1, d));
  if (kind === 'hex') return (2 * lw) / dd;
  if (kind === 'gyroid') return (1.1 * lw) / dd;
  return (Math.max(1, dirs) * lw) / dd;
}

function linesPath(cx: number, cy: number, angle: number, spacing: number, phase: number, extent: number) {
  let d = '';
  const n = Math.ceil(extent / spacing);
  for (let i = -n; i <= n; i++) {
    const o = (i + phase) * spacing;
    d += `M${-extent},${o}L${extent},${o}`;
  }
  return <path d={d} transform={`translate(${cx} ${cy}) rotate(${angle})`} />;
}

function hexPath(x0: number, y0: number, w: number, h: number, s: number) {
  // s: flat-to-flat distance of the hex cells
  const r = s / Math.sqrt(3);
  let d = '';
  for (let row = -1; row * 1.5 * r < h + 2 * r; row++) {
    for (let col = -1; col * s < w + s; col++) {
      const cx = x0 + col * s + (row % 2 ? s / 2 : 0), cy = y0 + row * 1.5 * r;
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 3) * k + Math.PI / 6;
        d += `${k ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
      }
      d += 'Z';
    }
  }
  return <path d={d} />;
}

function gyroidPath(x0: number, y0: number, w: number, h: number, s: number) {
  let d = '';
  const period = s * 2, amp = s * 0.32;
  for (let y = y0 - s; y < y0 + h + s; y += s) {
    const shift = Math.round((y - y0) / s) % 2 ? period / 2 : 0;
    for (let x = x0 - period; x <= x0 + w + period; x += 0.4) {
      const yy = y + amp * Math.sin(((x + shift) / period) * Math.PI * 2);
      d += `${x <= x0 - period ? 'M' : 'L'}${x.toFixed(2)},${yy.toFixed(2)}`;
    }
  }
  return <path d={d} />;
}

function concentricPath(x0: number, y0: number, w: number, h: number, r: number, s: number) {
  const out = [];
  for (let i = 0; i * s * 2 < Math.min(w, h); i++) {
    const inset = i * s;
    out.push(<rect key={i} x={x0 + inset} y={y0 + inset} width={w - 2 * inset} height={h - 2 * inset} rx={Math.max(0, r - inset)} />);
  }
  return <>{out}</>;
}

function lightningPath(x0: number, y0: number, w: number, h: number, s: number) {
  // deterministic pseudo random branching, sparse like the real thing
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let d = '';
  const branch = (x: number, y: number, a: number, len: number, depth: number) => {
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    d += `M${x.toFixed(2)},${y.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`;
    if (depth <= 0) return;
    branch(x2, y2, a + (rnd() - 0.5) * 1.2, len * 0.72, depth - 1);
    if (rnd() > 0.35) branch(x2, y2, a + (rnd() > 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6), len * 0.6, depth - 2);
  };
  for (let x = x0 + s / 2; x < x0 + w; x += s * 1.6) branch(x, y0 + h, -Math.PI / 2 + (rnd() - 0.5) * 0.4, h * 0.36, 4);
  return <path d={d} />;
}

function hilbertPath(x0: number, y0: number, w: number, h: number, s: number) {
  const size = Math.max(w, h);
  let order = 1;
  while (size / 2 ** order > s && order < 7) order++;
  const n = 2 ** order, step = size / n;
  const pts: [number, number][] = [];
  for (let i = 0; i < n * n; i++) {
    let t = i, x = 0, y = 0;
    for (let sN = 1; sN < n; sN *= 2) {
      const rx = 1 & (t / 2), ry = 1 & (t ^ rx);
      if (ry === 0) { if (rx === 1) { x = sN - 1 - x; y = sN - 1 - y; } [x, y] = [y, x]; }
      x += sN * rx; y += sN * ry; t = Math.floor(t / 4);
    }
    pts.push([x0 + (x + 0.5) * step, y0 + (y + 0.5) * step]);
  }
  return <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('')} />;
}

function spiralPath(cx: number, cy: number, maxR: number, s: number) {
  let d = '';
  for (let a = 0; ; a += 0.08) {
    const r = (s * a) / (2 * Math.PI);
    if (r > maxR) break;
    d += `${a ? 'L' : 'M'}${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return <path d={d} />;
}

export interface CrossSectionProps {
  settings: Settings;
  color: string;
  overrides: Set<string>;
}

export default function CrossSection({ settings: s, color, overrides }: CrossSectionProps) {
  const uid = useId().replace(/:/g, '');
  const lw = num(s.inner_wall_line_width ?? s.perimeter_extrusion_width ?? s.line_width ?? s.extrusion_width, 0.42) || 0.42;
  const nozzle = num(s.nozzle_diameter ?? s.machine_nozzle_size, 0.4);
  const lineW = lw > 0 && lw < 3 ? lw : nozzle * 1.05;
  const walls = Math.max(0, Math.round(num(s.wall_loops ?? s.perimeters ?? s.wall_line_count, 2)));
  const density = percent(s.sparse_infill_density ?? s.fill_density ?? s.infill_sparse_density, 0.15);
  const patternRaw = first(s.sparse_infill_pattern ?? s.fill_pattern ?? s.infill_pattern) ?? 'grid';
  const angle = num(s.infill_direction ?? s.fill_angle, 45);
  const layer = num(s.layer_height, 0.2);
  const top = Math.round(num(s.top_shell_layers ?? s.top_solid_layers ?? s.top_layers, 4));
  const bottom = Math.round(num(s.bottom_shell_layers ?? s.bottom_solid_layers ?? s.bottom_layers, 3));
  const vase = /^(1|true)$/i.test(first(s.spiral_mode ?? s.spiral_vase ?? s.magic_spiralize) ?? '');

  const { dirs, kind, known } = patternDirs(patternRaw);
  const spacing = spacingFor(kind, dirs.length, lineW, density);
  const wallBand = walls * lineW;
  const ix = wallBand, iy = wallBand, iw = W - 2 * wallBand, ih = H - 2 * wallBand;
  const cx = W / 2, cy = H / 2, ext = Math.hypot(W, H);

  let infill: React.ReactNode = null;
  if (!vase && density > 0.001 && iw > 0 && ih > 0) {
    if (density >= 0.999) infill = linesPath(cx, cy, angle, lineW, 0, ext);
    else if (kind === 'lines') infill = dirs.map((d, i) => <g key={i}>{linesPath(cx, cy, angle + d.angle, spacing, d.offset ?? 0, ext)}</g>);
    else if (kind === 'hex') infill = hexPath(ix, iy, iw, ih, spacing);
    else if (kind === 'gyroid') infill = gyroidPath(ix, iy, iw, ih, spacing);
    else if (kind === 'concentric') infill = concentricPath(ix + lineW / 2, iy + lineW / 2, iw - lineW, ih - lineW, Math.max(0, R - wallBand), spacing);
    else if (kind === 'lightning') infill = lightningPath(ix, iy, iw, ih, spacing);
    else if (kind === 'hilbert') infill = hilbertPath(ix, iy, iw, ih, spacing);
    else if (kind === 'spiral') infill = spiralPath(cx, cy, ext / 2, spacing);
  }

  const wallRects = Array.from({ length: walls }, (_, i) => {
    const inset = lineW * (i + 0.5);
    return <rect key={i} x={inset} y={inset} width={W - 2 * inset} height={H - 2 * inset} rx={Math.max(0.1, R - inset)} />;
  });

  // side cut: 10 mm wide, height adapts so top/bottom are readable
  const SW = 14;
  const shellH = (top + bottom) * layer;
  const SH = Math.max(6, shellH + 3);
  const layers = Math.round(SH / layer);
  const sideW = vase ? lineW : wallBand;
  const sideLines: React.ReactNode[] = [];
  for (let i = 0; i < layers; i++) {
    const y = SH - (i + 1) * layer;
    const solid = i < bottom || i >= layers - top || vase;
    sideLines.push(
      <g key={i}>
        <rect x={0} y={y} width={sideW} height={layer * 0.92} rx={layer * 0.45} className="xs-wall" />
        <rect x={SW - sideW} y={y} width={sideW} height={layer * 0.92} rx={layer * 0.45} className="xs-wall" />
        {!vase && solid && <rect x={sideW} y={y} width={SW - 2 * sideW} height={layer * 0.92} rx={layer * 0.45} className="xs-solid" />}
      </g>,
    );
  }
  const sideInfill: React.ReactNode[] = [];
  if (!vase && density > 0.001) {
    const step = Math.max(lineW * 1.2, kind === 'lines' ? spacing / Math.max(1, dirs.length) : spacing / 2);
    for (let x = sideW + step / 2; x < SW - sideW; x += step) {
      sideInfill.push(<rect key={x} x={x - lineW / 2} y={top * layer} width={lineW} height={SH - (top + bottom) * layer} className="xs-infill-col" />);
    }
  }

  const mark = (keys: string[]) => (keys.some((k) => overrides.has(k)) ? ' is-override' : '');

  return (
    <figure className="xsec" style={{ ['--fil' as string]: color }}>
      <div className="xsec-views">
        <svg viewBox={`-0.5 -0.5 ${W + 1} ${H + 1}`} className="xsec-top" aria-label="Querschnitt von oben">
          <defs>
            <clipPath id={`in${uid}`}>
              <rect x={ix} y={iy} width={Math.max(0, iw)} height={Math.max(0, ih)} rx={Math.max(0, R - wallBand)} />
            </clipPath>
          </defs>
          <rect x={0} y={0} width={W} height={H} rx={R} className="xs-ghost" />
          <g className="xs-infill" strokeWidth={lineW} clipPath={`url(#in${uid})`}>{infill}</g>
          <g className="xs-walls" strokeWidth={lineW * 0.9}>{wallRects}</g>
        </svg>
        <svg viewBox={`-0.3 -0.3 ${SW + 0.6} ${SH + 0.6}`} className="xsec-side" aria-label="Schnitt von der Seite">
          <g>{sideInfill}</g>
          <g>{sideLines}</g>
        </svg>
      </div>
      <figcaption className="xsec-legend">
        <div className={`xl${mark(['sparse_infill_pattern', 'fill_pattern', 'infill_pattern', 'sparse_infill_density', 'fill_density', 'infill_sparse_density'])}`}>
          <span className="xl-v">{vase ? 'Vase' : `${Math.round(density * 100)} %`}</span>
          <span className="xl-k">{vase ? 'nur eine Wand, kein Infill' : `${translateEnum(patternRaw)}${known ? '' : ' (vereinfacht dargestellt)'}`}</span>
        </div>
        <div className={`xl${mark(['wall_loops', 'perimeters', 'wall_line_count'])}`}>
          <span className="xl-v">{vase ? 1 : walls}</span>
          <span className="xl-k">{walls === 1 ? 'Wand' : 'Wände'}, {(wallBand).toFixed(2).replace('.', ',')} mm stark</span>
        </div>
        <div className={`xl${mark(['top_shell_layers', 'top_solid_layers', 'bottom_shell_layers', 'bottom_solid_layers'])}`}>
          <span className="xl-v">{top} / {bottom}</span>
          <span className="xl-k">Schichten oben / unten bei {String(layer).replace('.', ',')} mm</span>
        </div>
      </figcaption>
    </figure>
  );
}
