import { zipSync } from 'fflate';
import type { Mat12, Part, PrintObject, Project } from './types';
import { mulMat } from './project';

export interface ExportOptions {
  /** include modifier / negative / blocker volumes as well */
  includeHelpers?: boolean;
  /** keep plate position instead of centering on origin */
  keepPosition?: boolean;
}

interface Tri { a: number[]; b: number[]; c: number[] }

function apply(m: Mat12, x: number, y: number, z: number): number[] {
  return [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
}

function det(m: Mat12) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function exportableParts(o: PrintObject, includeHelpers = false): Part[] {
  return o.parts.filter((p) => includeHelpers || p.kind === 'model');
}

function collectTris(project: Project, o: PrintObject, extra: Mat12 | null, opts: ExportOptions, sink: Tri[]) {
  for (const part of exportableParts(o, opts.includeHelpers)) {
    const mesh = project.meshes.get(part.meshKey);
    if (!mesh) continue;
    let m = mulMat(part.matrix, o.transform);
    if (extra) m = mulMat(m, extra);
    const flip = det(m) < 0; // mirrored objects need winding flipped
    const P = mesh.positions, I = mesh.indices;
    for (let t = part.triStart; t < part.triEnd; t++) {
      const i0 = I[t * 3] * 3, i1 = I[t * 3 + 1] * 3, i2 = I[t * 3 + 2] * 3;
      const a = apply(m, P[i0], P[i0 + 1], P[i0 + 2]);
      const b = apply(m, P[i1], P[i1 + 1], P[i1 + 2]);
      const c = apply(m, P[i2], P[i2 + 1], P[i2 + 2]);
      sink.push(flip ? { a, b: c, c: b } : { a, b, c });
    }
  }
}

function bounds(tris: Tri[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const v of [t.a, t.b, t.c]) for (let k = 0; k < 3; k++) {
    if (v[k] < min[k]) min[k] = v[k];
    if (v[k] > max[k]) max[k] = v[k];
  }
  return { min, max };
}

function toBinaryStl(tris: Tri[], header: string, scale: number, shift: number[]): Uint8Array {
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const dv = new DataView(buf);
  const h = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(h);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const a = t.a.map((v, k) => (v - shift[k]) * scale), b = t.b.map((v, k) => (v - shift[k]) * scale), c = t.c.map((v, k) => (v - shift[k]) * scale);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const v of [nx, ny, nz, ...a, ...b, ...c]) { dv.setFloat32(o, v, true); o += 4; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

const UNIT_SCALE: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

function makeStl(project: Project, objs: PrintObject[], opts: ExportOptions, label: string): Uint8Array {
  const tris: Tri[] = [];
  for (const o of objs) collectTris(project, o, null, opts, tris);
  const scale = UNIT_SCALE[project.unit] ?? 1;
  let shift = [0, 0, 0];
  if (tris.length) {
    const { min, max } = bounds(tris);
    if (opts.keepPosition) {
      const plate = project.plates.find((p) => p.index === objs[0]?.plate);
      shift = [plate?.offset[0] ?? 0, plate?.offset[1] ?? 0, 0];
    } else {
      shift = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
    }
  }
  return toBinaryStl(tris, `3MF Lupe export: ${label}`, scale, shift);
}

export function safeName(s: string) {
  return s.replace(/\.(stl|3mf|obj|step|stp)$/i, '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'objekt';
}

export function download(data: Uint8Array | string, name: string, type = 'application/octet-stream') {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportObjectStl(project: Project, o: PrintObject, opts: ExportOptions = {}) {
  download(makeStl(project, [o], opts, o.name), `${safeName(o.name)}.stl`, 'model/stl');
}

export function exportMergedStl(project: Project, objs: PrintObject[], name: string, opts: ExportOptions = {}) {
  download(makeStl(project, objs, { ...opts, keepPosition: true }, name), `${safeName(name)}.stl`, 'model/stl');
}

export function exportZip(project: Project, objs: PrintObject[], name: string, opts: ExportOptions = {}) {
  const files: Record<string, Uint8Array> = {};
  const used = new Map<string, number>();
  for (const o of objs) {
    let base = safeName(o.name);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    if (n) base = `${base}_${n + 1}`;
    const plate = project.plates.length > 1 && o.plate ? `Platte ${o.plate}/` : '';
    files[`${plate}${base}.stl`] = makeStl(project, [o], opts, o.name);
  }
  download(zipSync(files, { level: 6 }), `${safeName(name)}_stl.zip`, 'application/zip');
}
