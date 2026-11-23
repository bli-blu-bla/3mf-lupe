/// <reference lib="webworker" />
import { unzipSync } from 'fflate';
import type { ArchiveEntry, Mat12, RawBuildItem, RawObject, WorkerResult } from './types';
import { IDENTITY } from './types';
import { paintState } from './paint';

const dec = new TextDecoder();

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[e] ?? m;
  });
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = decodeXml(m[3] ?? m[4] ?? '');
  return out;
}

function parseMatrix(s: string | undefined): Mat12 {
  if (!s) return IDENTITY.slice();
  const n = s.trim().split(/\s+/).map(Number);
  return n.length === 12 && n.every(Number.isFinite) ? n : IDENTITY.slice();
}

function normPath(p: string): string {
  return p.replace(/^\/+/, '');
}

function parseVertices(block: string): Float32Array {
  // Count first so we can allocate once
  let count = 0;
  let i = -1;
  while ((i = block.indexOf('<vertex', i + 1)) >= 0) count++;
  const out = new Float32Array(count * 3);
  const re = /<vertex\b([^>]*)>/g;
  const fast = /^\s*x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(block))) {
    const f = fast.exec(m[1]);
    if (f) {
      out[k++] = +f[1];
      out[k++] = +f[2];
      out[k++] = +f[3];
    } else {
      const a = attrs(m[1]);
      out[k++] = +a.x;
      out[k++] = +a.y;
      out[k++] = +a.z;
    }
  }
  // the count above also hits the <vertices> container tag
  return k === out.length ? out : out.slice(0, k);
}

function parseTriangles(block: string) {
  let count = 0;
  let i = -1;
  while ((i = block.indexOf('<triangle', i + 1)) >= 0) count++;
  const out = new Uint32Array(count * 3);
  const re = /<triangle\b([^>]*)>/g;
  const fast = /^\s*v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"\s*\/?$/;
  const paint = { supports: 0, seam: 0, color: 0 };
  let sup: Uint8Array | undefined, col: Uint8Array | undefined;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(block))) {
    const f = fast.exec(m[1]);
    if (f) {
      out[k++] = +f[1];
      out[k++] = +f[2];
      out[k++] = +f[3];
    } else {
      const a = attrs(m[1]);
      const t = k / 3;
      out[k++] = +a.v1;
      out[k++] = +a.v2;
      out[k++] = +a.v3;
      const ps = a['slic3rpe:custom_supports'] ?? a.paint_supports;
      const pc = a['slic3rpe:mmu_segmentation'] ?? a.paint_color;
      if (ps) { paint.supports++; (sup ??= new Uint8Array(count))[t] = paintState(ps); }
      if (a['slic3rpe:custom_seam'] || a.paint_seam) paint.seam++;
      if (pc) { paint.color++; (col ??= new Uint8Array(count))[t] = paintState(pc); }
    }
  }
  const n = k / 3;
  return {
    indices: k === out.length ? out : out.slice(0, k),
    paint,
    paintSupports: sup && sup.length !== n ? sup.slice(0, n) : sup,
    paintColors: col && col.length !== n ? col.slice(0, n) : col,
  };
}

function parseModel(text: string, path: string, objects: RawObject[]): { head: string; build: RawBuildItem[]; unit: string } {
  const resIdx = text.indexOf('<resources');
  const head = resIdx >= 0 ? text.slice(0, resIdx) : text.slice(0, 4096);
  const modelTag = /<model\b([^>]*)>/.exec(head);
  const unit = modelTag ? attrs(modelTag[1]).unit ?? 'millimeter' : 'millimeter';

  const objRe = /<object\b([^>]*?)(\/>|>([\s\S]*?)<\/object>)/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(text))) {
    const a = attrs(m[1]);
    const body = m[3] ?? '';
    const obj: RawObject = {
      key: `${path}#${a.id}`,
      id: a.id,
      path,
      type: a.type ?? 'model',
      name: a.name,
      components: [],
    };
    const vs = body.indexOf('<vertices');
    if (vs >= 0) {
      const ve = body.indexOf('</vertices>', vs);
      const ts = body.indexOf('<triangles', ve);
      const te = body.indexOf('</triangles>', ts);
      const positions = parseVertices(body.slice(vs, ve));
      const tri = ts >= 0 ? parseTriangles(body.slice(ts, te)) : { indices: new Uint32Array(), paint: { supports: 0, seam: 0, color: 0 } };
      obj.mesh = { positions, ...tri };
    }
    const compRe = /<component\b([^>]*)>/g;
    let c: RegExpExecArray | null;
    while ((c = compRe.exec(body))) {
      const ca = attrs(c[1]);
      const p = ca['p:path'] ?? ca.path;
      obj.components.push({
        path: p ? normPath(p) : path,
        objectid: ca.objectid,
        transform: parseMatrix(ca.transform),
      });
    }
    objects.push(obj);
  }

  const build: RawBuildItem[] = [];
  const bs = text.lastIndexOf('<build');
  if (bs >= 0) {
    const itemRe = /<item\b([^>]*)>/g;
    itemRe.lastIndex = bs;
    let it: RegExpExecArray | null;
    while ((it = itemRe.exec(text))) {
      const ia = attrs(it[1]);
      build.push({ objectid: ia.objectid, transform: parseMatrix(ia.transform), printable: ia.printable !== '0' });
    }
  }
  return { head, build, unit };
}

function findMainModel(files: Record<string, Uint8Array>): string {
  const rels = files['_rels/.rels'];
  if (rels) {
    const t = dec.decode(rels);
    const re = /<Relationship\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const a = attrs(m[1]);
      if (a.Type?.endsWith('/3dmodel') && a.Target) {
        const p = normPath(a.Target);
        if (files[p]) return p;
      }
    }
  }
  if (files['3D/3dmodel.model']) return '3D/3dmodel.model';
  const any = Object.keys(files).find((k) => k.toLowerCase().endsWith('.model'));
  if (!any) throw new Error('Keine 3D-Modelldatei (.model) im Archiv gefunden. Ist das wirklich eine 3MF-Datei?');
  return any;
}

self.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
  const t0 = performance.now();
  try {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(new Uint8Array(ev.data));
    } catch {
      throw new Error('Die Datei lässt sich nicht entpacken. 3MF-Dateien sind ZIP-Archive. Diese hier ist beschädigt oder keine 3MF-Datei.');
    }
    const mainPath = findMainModel(files);
    const objects: RawObject[] = [];
    const main = parseModel(dec.decode(files[mainPath]), mainPath, objects);

    // Production extension: components may point into other .model files
    const pending = new Set<string>();
    for (const o of objects) for (const c of o.components) if (c.path !== mainPath) pending.add(c.path);
    for (const p of pending) {
      if (files[p]) parseModel(dec.decode(files[p]), p, objects);
    }

    const metadata: Record<string, string> = {};
    const metaRe = /<metadata\b([^>]*?)(?:\/>|>([\s\S]*?)<\/metadata>)/g;
    let m: RegExpExecArray | null;
    while ((m = metaRe.exec(main.head))) {
      const a = attrs(m[1]);
      if (a.name) metadata[a.name] = decodeXml(m[2] ?? '').trim();
    }

    const entries: ArchiveEntry[] = Object.entries(files)
      .filter(([p]) => !p.endsWith('/'))
      .map(([path, data]) => ({ path, size: data.length, data }));

    const result: WorkerResult = {
      mainPath,
      unit: main.unit,
      metadata,
      objects,
      build: main.build,
      entries,
      parseMs: performance.now() - t0,
    };
    const transfer: Transferable[] = [];
    for (const o of objects) if (o.mesh) {
      transfer.push(o.mesh.positions.buffer, o.mesh.indices.buffer);
      if (o.mesh.paintSupports) transfer.push(o.mesh.paintSupports.buffer);
      if (o.mesh.paintColors) transfer.push(o.mesh.paintColors.buffer);
    }
    // entries share the unzip buffers; fflate allocates one per file
    const seen = new Set<ArrayBufferLike>();
    for (const e of entries) {
      if (!seen.has(e.data.buffer)) {
        seen.add(e.data.buffer);
        transfer.push(e.data.buffer as ArrayBuffer);
      }
    }
    (self as unknown as Worker).postMessage({ ok: true, result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
