import type {
  ArchiveEntry, CustomGcode, CustomGcodeKind, Mat12, Part, PartKind, Plate, PrintObject, Project, RawMesh, RawObject,
  Settings, SliceInfo, SlicerFamily, SlicerInfo, WorkerResult,
} from './types';
import { IDENTITY } from './types';

const dec = new TextDecoder();

export function entryText(entries: ArchiveEntry[], path: string): string | undefined {
  const e = entries.find((x) => x.path === path) ?? entries.find((x) => x.path.toLowerCase() === path.toLowerCase());
  return e ? dec.decode(e.data) : undefined;
}

function xml(text: string | undefined): Document | null {
  if (!text) return null;
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
}

/* ---------- slicer detection ---------- */

export function detectSlicer(meta: Record<string, string>, entries: ArchiveEntry[]): SlicerInfo {
  const app = meta.Application ?? meta['Application'] ?? '';
  const paths = entries.map((e) => e.path);
  const m = /^([A-Za-z][\w .]*?)[-_ ]v?(\d[\w.]*)$/.exec(app.trim());
  const rawName = m ? m[1] : app;
  const version = m ? m[2].replace(/^0(\d)\./, '$1.') : '';
  const lower = app.toLowerCase();
  let family: SlicerFamily = 'generic';
  let name = rawName || 'Unbekannt';
  if (lower.includes('bambu')) { family = 'bambu'; name = 'Bambu Studio'; }
  else if (lower.includes('orca')) { family = 'orca'; name = 'OrcaSlicer'; }
  else if (lower.includes('creality')) { family = 'creality'; name = 'Creality Print'; }
  else if (lower.includes('anycubic')) { family = 'anycubic'; name = 'Anycubic Slicer'; }
  else if (lower.includes('prusa') || lower.includes('slic3r') || lower.includes('superslicer')) { family = 'prusa'; name = rawName || 'PrusaSlicer'; }
  else if (lower.includes('cura') || paths.some((p) => p.startsWith('Cura/'))) { family = 'cura'; name = 'UltiMaker Cura'; }
  else if (paths.includes('Metadata/project_settings.config')) { family = 'orca'; name = rawName || 'Orca-basierter Slicer'; }
  else if (paths.includes('Metadata/Slic3r_PE.config')) { family = 'prusa'; name = rawName || 'PrusaSlicer'; }
  return { family, name, version, application: app };
}

export function isBambuLike(f: SlicerFamily) {
  return f === 'bambu' || f === 'orca' || f === 'creality' || f === 'anycubic';
}

/* ---------- config parsers ---------- */

function parsePrusaIni(text: string): Settings {
  const out: Settings = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^;\s*([\w-]+)\s*=\s?(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function parseCuraCfgs(entries: ArchiveEntry[]): Settings {
  // Cura stores stacks as INI files; [values] sections hold the overrides.
  const out: Settings = {};
  const cfgs = entries.filter((e) => e.path.startsWith('Cura/') && e.path.endsWith('.cfg'));
  // global first, then extruder / user changes so that more specific values win
  cfgs.sort((a, b) => Number(a.path.includes('extruder')) - Number(b.path.includes('extruder')));
  for (const e of cfgs) {
    let section = '';
    for (const line of dec.decode(e.data).split(/\r?\n/)) {
      const s = /^\[(.+)\]$/.exec(line.trim());
      if (s) { section = s[1]; continue; }
      const kv = /^([\w.]+)\s*=\s*(.*)$/.exec(line);
      if (kv && (section === 'values' || section === 'metadata' || section === 'general')) {
        if (section === 'values' || !(kv[1] in out)) out[kv[1]] = kv[2];
      }
    }
  }
  return out;
}

function loadSettings(family: SlicerFamily, entries: ArchiveEntry[]): Settings {
  const bambu = entryText(entries, 'Metadata/project_settings.config');
  if (bambu) {
    try {
      const j = JSON.parse(bambu) as Record<string, unknown>;
      const out: Settings = {};
      for (const [k, v] of Object.entries(j)) {
        if (Array.isArray(v)) out[k] = v.map(String);
        else if (v !== null && typeof v === 'object') out[k] = JSON.stringify(v);
        else out[k] = String(v);
      }
      return out;
    } catch { /* fall through */ }
  }
  const prusa = entryText(entries, 'Metadata/Slic3r_PE.config');
  if (prusa) return parsePrusaIni(prusa);
  if (family === 'cura' || entries.some((e) => e.path.startsWith('Cura/'))) return parseCuraCfgs(entries);
  return {};
}

/* ---------- geometry helpers ---------- */

export function mulMat(a: Mat12, b: Mat12): Mat12 {
  // row-vector: p · A · B
  const r: Mat12 = new Array(12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j];
  return r;
}

function prusaMatrix16to12(s: string | undefined): Mat12 {
  // Slic3r_PE_model.config stores column-major-ish 4x4 as "r00 r01 r02 t0 r10 ..." (row-major, column vectors)
  if (!s) return IDENTITY.slice();
  const n = s.trim().split(/\s+/).map(Number);
  if (n.length !== 16) return IDENTITY.slice();
  return [n[0], n[4], n[8], n[1], n[5], n[9], n[2], n[6], n[10], n[3], n[7], n[11]];
}

function kindFrom(s: string | undefined): PartKind {
  const v = (s ?? '').toLowerCase();
  if (!v || v === 'modelpart' || v === 'normal_part' || v === 'model') return 'model';
  if (v.includes('modifier')) return 'modifier';
  if (v.includes('negative')) return 'negative';
  if (v.includes('blocker')) return 'support_blocker';
  if (v.includes('enforcer')) return 'support_enforcer';
  return 'other';
}

/* ---------- per-object config ---------- */

interface ObjCfg {
  name?: string;
  extruder?: number;
  settings: Record<string, string>;
  parts: Map<string, { name?: string; kind: PartKind; settings: Record<string, string>; extruder?: number; first?: number; last?: number; matrix?: Mat12; sourceFile?: string }>;
  partOrder: string[];
  layerRanges: { from: number; to: number; settings: Record<string, string> }[];
}

const RESERVED = new Set(['name', 'extruder', 'matrix', 'source_file', 'source_object_id', 'source_volume_id',
  'source_offset_x', 'source_offset_y', 'source_offset_z', 'source_in_inches', 'source_in_meters', 'volume_type',
  'modifier', 'mesh_stat', 'face_count', 'identify_id']);

function readMetas(el: Element, type?: string) {
  const out: Record<string, string> = {};
  for (const md of Array.from(el.children)) {
    if (md.tagName !== 'metadata') continue;
    if (type && md.getAttribute('type') && md.getAttribute('type') !== type) continue;
    const k = md.getAttribute('key');
    if (k) out[k] = md.getAttribute('value') ?? '';
  }
  return out;
}

function splitSettings(m: Record<string, string>) {
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (!RESERVED.has(k)) settings[k] = v;
  return settings;
}

function loadObjectConfigs(entries: ArchiveEntry[]): Map<string, ObjCfg> {
  const map = new Map<string, ObjCfg>();
  const doc = xml(entryText(entries, 'Metadata/model_settings.config')) ?? xml(entryText(entries, 'Metadata/Slic3r_PE_model.config'));
  if (!doc) return map;
  for (const o of Array.from(doc.querySelectorAll('config > object'))) {
    const id = o.getAttribute('id') ?? '';
    const metas = readMetas(o, 'object');
    const cfg: ObjCfg = {
      name: metas.name,
      extruder: metas.extruder ? Number(metas.extruder) : undefined,
      settings: splitSettings(metas),
      parts: new Map(),
      partOrder: [],
      layerRanges: [],
    };
    // Bambu/Orca: <part id subtype>, PrusaSlicer: <volume firstid lastid>
    for (const p of Array.from(o.children)) {
      if (p.tagName === 'part') {
        const pm = readMetas(p);
        const pid = p.getAttribute('id') ?? String(cfg.partOrder.length);
        cfg.parts.set(pid, {
          name: pm.name, kind: kindFrom(p.getAttribute('subtype') ?? undefined), sourceFile: pm.source_file,
          settings: splitSettings(pm), extruder: pm.extruder ? Number(pm.extruder) : undefined,
        });
        cfg.partOrder.push(pid);
      } else if (p.tagName === 'volume') {
        const pm = readMetas(p, 'volume');
        const pid = String(cfg.partOrder.length);
        cfg.parts.set(pid, {
          name: pm.name, kind: kindFrom(pm.volume_type ?? (pm.modifier === '1' ? 'modifier' : undefined)),
          settings: splitSettings(pm), extruder: pm.extruder ? Number(pm.extruder) : undefined,
          first: Number(p.getAttribute('firstid')), last: Number(p.getAttribute('lastid')),
          matrix: prusaMatrix16to12(pm.matrix), sourceFile: pm.source_file,
        });
        cfg.partOrder.push(pid);
      } else if (p.tagName === 'layer_config_ranges' || p.tagName === 'range') {
        const ranges = p.tagName === 'range' ? [p] : Array.from(p.querySelectorAll('range'));
        for (const r of ranges) {
          const rm = readMetas(r);
          cfg.layerRanges.push({
            from: Number(r.getAttribute('min_z') ?? rm.min_z ?? 0),
            to: Number(r.getAttribute('max_z') ?? rm.max_z ?? 0),
            settings: splitSettings(rm),
          });
        }
      }
    }
    map.set(id, cfg);
  }
  return map;
}


/* ---------- PrusaSlicer / Bambu side files ---------- */

const RANGE_FILES = ['Metadata/Prusa_Slicer_layer_config_ranges.xml', 'Metadata/layer_config_ranges.xml'];
const PROFILE_FILES = ['Metadata/Prusa_Slicer_layers.txt', 'Metadata/Slic3r_PE_layers.txt', 'Metadata/layer_heights_profile.txt'];

function loadLayerRanges(entries: ArchiveEntry[]) {
  const out = new Map<string, { from: number; to: number; settings: Record<string, string> }[]>();
  for (const f of RANGE_FILES) {
    const doc = xml(entryText(entries, f));
    if (!doc) continue;
    for (const o of Array.from(doc.querySelectorAll('object'))) {
      const id = o.getAttribute('id') ?? '';
      const list = out.get(id) ?? [];
      for (const r of Array.from(o.querySelectorAll('range'))) {
        const settings: Record<string, string> = {};
        for (const opt of Array.from(r.children)) {
          const k = opt.getAttribute('opt_key') ?? opt.getAttribute('key');
          if (k) settings[k] = opt.getAttribute('value') ?? opt.textContent ?? '';
        }
        list.push({ from: Number(r.getAttribute('min_z') ?? 0), to: Number(r.getAttribute('max_z') ?? 0), settings });
      }
      out.set(id, list);
    }
  }
  return out;
}

function loadLayerProfiles(entries: ArchiveEntry[]) {
  const out = new Map<string, { min: number; max: number; points: number }>();
  for (const f of PROFILE_FILES) {
    const t = entryText(entries, f);
    if (!t) continue;
    for (const line of t.split(/\r?\n/)) {
      const m = /object_id=(\d+)\|(.*)/.exec(line);
      if (!m) continue;
      const nums = m[2].split(';').map(Number).filter(Number.isFinite);
      const hs = nums.filter((_, i) => i % 2 === 1).filter((h) => h > 0);
      if (hs.length) out.set(m[1], { min: Math.min(...hs), max: Math.max(...hs), points: hs.length });
    }
  }
  return out;
}

function gcodeKind(type: string | null, gcode: string | null): CustomGcodeKind {
  // PrusaSlicer / Bambu enum: 0 ColorChange, 1 PausePrint, 2 Custom, 3 Template, 4 ToolChange
  const t = type === null ? NaN : Number(type);
  if (t === 0) return 'color';
  if (t === 1) return 'pause';
  if (t === 3) return 'template';
  if (t === 4) return 'tool';
  if (t === 2) return 'custom';
  const g = (gcode ?? '').trim();
  if (/^M600\b/i.test(g)) return 'color';
  if (/^M60[01]\b/i.test(g) || /pause/i.test(g)) return 'pause';
  if (/tool_change/i.test(g)) return 'tool';
  return 'custom';
}

function loadCustomGcodes(entries: ArchiveEntry[]): CustomGcode[] {
  const out: CustomGcode[] = [];
  const read = (el: Element, plate: number | null, zAttr: string) => {
    const ext = el.getAttribute('extruder');
    out.push({
      plate,
      z: Number(el.getAttribute(zAttr) ?? 0),
      kind: gcodeKind(el.getAttribute('type'), el.getAttribute('gcode')),
      extruder: ext ? Number(ext) : undefined,
      color: el.getAttribute('color') || undefined,
      gcode: el.getAttribute('gcode') || undefined,
      extra: el.getAttribute('extra') || undefined,
    });
  };
  const prusa = xml(entryText(entries, 'Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml'));
  if (prusa) for (const c of Array.from(prusa.querySelectorAll('code'))) read(c, null, 'print_z');
  const bambu = xml(entryText(entries, 'Metadata/custom_gcode_per_layer.xml'));
  if (bambu) for (const p of Array.from(bambu.querySelectorAll('plate'))) {
    const id = Number(p.querySelector('plate_info')?.getAttribute('id') ?? 1);
    for (const l of Array.from(p.querySelectorAll('layer'))) read(l, id, 'top_z');
  }
  return out.sort((a, b) => (a.plate ?? 0) - (b.plate ?? 0) || a.z - b.z);
}

/* ---------- plates ---------- */

function parseBed(settings: Settings): { shape: [number, number][]; width: number; depth: number } {
  let pts: string[] = [];
  const pa = settings.printable_area ?? settings.bed_shape;
  if (Array.isArray(pa)) pts = pa;
  else if (typeof pa === 'string') pts = pa.split(',');
  let shape = pts.map((p) => p.split('x').map(Number) as [number, number]).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (!shape.length) {
    const w = Number(settings.machine_width ?? 0), d = Number(settings.machine_depth ?? 0);
    shape = w && d ? [[0, 0], [w, 0], [w, d], [0, d]] : [];
  }
  if (!shape.length) return { shape: [], width: 0, depth: 0 };
  const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
  return { shape, width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}

function parseSliceInfo(entries: ArchiveEntry[]): Map<number, SliceInfo> {
  const map = new Map<number, SliceInfo>();
  const doc = xml(entryText(entries, 'Metadata/slice_info.config'));
  if (!doc) return map;
  for (const p of Array.from(doc.querySelectorAll('plate'))) {
    const m = readMetas(p);
    const idx = Number(m.index);
    if (!idx) continue;
    map.set(idx, {
      prediction: m.prediction ? Number(m.prediction) : undefined,
      weight: m.weight ? Number(m.weight) : undefined,
      filaments: Array.from(p.querySelectorAll('filament')).map((f) => ({
        id: f.getAttribute('id') ?? '',
        type: f.getAttribute('type') ?? undefined,
        color: f.getAttribute('color') ?? undefined,
        usedM: f.getAttribute('used_m') ? Number(f.getAttribute('used_m')) : undefined,
        usedG: f.getAttribute('used_g') ? Number(f.getAttribute('used_g')) : undefined,
      })),
    });
  }
  return map;
}

/* ---------- assembly ---------- */

export function buildProject(res: WorkerResult, fileName: string, fileSize: number): Project {
  const { entries } = res;
  const slicer = detectSlicer(res.metadata, entries);
  const settings = loadSettings(slicer.family, entries);
  const objCfgs = loadObjectConfigs(entries);
  const extraRanges = loadLayerRanges(entries);
  const profiles = loadLayerProfiles(entries);
  const rawByKey = new Map<string, RawObject>(res.objects.map((o) => [o.key, o]));
  const meshes = new Map<string, RawMesh>();
  for (const o of res.objects) if (o.mesh) meshes.set(o.key, o.mesh);

  const changedFromSystem = new Set<string>();
  const dsts = settings.different_settings_to_system;
  if (Array.isArray(dsts)) for (const s of dsts) for (const k of s.split(';')) if (k) changedFromSystem.add(k);

  const instanceCount = new Map<string, number>();
  const objects: PrintObject[] = [];

  res.build.forEach((item, idx) => {
    const key = `${res.mainPath}#${item.objectid}`;
    const root = rawByKey.get(key);
    if (!root) return;
    const cfg = objCfgs.get(item.objectid);
    const inst = instanceCount.get(item.objectid) ?? 0;
    instanceCount.set(item.objectid, inst + 1);

    const parts: Part[] = [];
    const paint = { supports: 0, seam: 0, color: 0 };
    let triangles = 0;

    const addMesh = (raw: RawObject, matrix: Mat12, partId: string) => {
      const mesh = raw.mesh!;
      const total = mesh.indices.length / 3;
      paint.supports += mesh.paint.supports; paint.seam += mesh.paint.seam; paint.color += mesh.paint.color;
      // PrusaSlicer: one mesh, volumes are triangle ranges
      const volumes = cfg ? cfg.partOrder.map((id) => cfg.parts.get(id)!).filter((p) => p.first !== undefined) : [];
      if (volumes.length && raw.key === key) {
        for (const v of volumes) {
          const s = Math.max(0, v.first!), e = Math.min(total, v.last! + 1);
          parts.push({ name: v.name ?? raw.name ?? `Teil ${parts.length + 1}`, kind: v.kind, meshKey: raw.key, triStart: s, triEnd: e, matrix, settings: v.settings, extruder: v.extruder, sourceFile: v.sourceFile });
          triangles += e - s;
        }
        return;
      }
      const pc = cfg?.parts.get(partId);
      parts.push({
        name: pc?.name ?? raw.name ?? `Teil ${parts.length + 1}`,
        kind: pc?.kind ?? (raw.type === 'support' ? 'support_blocker' : 'model'),
        meshKey: raw.key, triStart: 0, triEnd: total, matrix,
        settings: pc?.settings ?? {}, extruder: pc?.extruder, sourceFile: pc?.sourceFile,
      });
      triangles += total;
    };

    const walk = (raw: RawObject, matrix: Mat12, depth: number) => {
      if (depth > 16) return;
      if (raw.mesh && raw.mesh.indices.length) addMesh(raw, matrix, raw.id);
      for (const c of raw.components) {
        const child = rawByKey.get(`${c.path}#${c.objectid}`);
        if (child) walk(child, mulMat(c.transform, matrix), depth + 1);
      }
    };
    walk(root, IDENTITY.slice(), 0);

    const baseName = cfg?.name ?? root.name ?? `Objekt ${item.objectid}`;
    objects.push({
      uid: `o${idx}`,
      id: item.objectid,
      name: baseName,
      instance: inst,
      plate: null,
      transform: item.transform,
      parts,
      settings: cfg?.settings ?? {},
      extruder: cfg?.extruder ?? 1,
      printable: item.printable,
      triangles,
      paint,
      layerRanges: [...(cfg?.layerRanges ?? []), ...(extraRanges.get(item.objectid) ?? [])],
      layerProfile: profiles.get(item.objectid),
    });
  });

  // Mark instance numbers in names when an object is placed more than once
  for (const o of objects) if ((instanceCount.get(o.id) ?? 1) > 1) o.name = `${o.name} (${o.instance + 1})`;

  const bedInfo = parseBed(settings);
  const plates: Plate[] = [];
  const sliceInfo = parseSliceInfo(entries);
  const msDoc = xml(entryText(entries, 'Metadata/model_settings.config'));
  const plateEls = msDoc ? Array.from(msDoc.querySelectorAll('config > plate')) : [];
  const gapFactor = 1.2; // Bambu/Orca lay plates out with 20 % gap
  if (plateEls.length) {
    const cols = Math.ceil(Math.sqrt(plateEls.length));
    plateEls.forEach((pe, i) => {
      const m = readMetas(pe);
      const index = Number(m.plater_id ?? i + 1);
      const col = (index - 1) % cols, row = Math.floor((index - 1) / cols);
      const plate: Plate = {
        index,
        name: m.plater_name || `Platte ${index}`,
        offset: [col * bedInfo.width * gapFactor, -row * bedInfo.depth * gapFactor],
        objectUids: [],
        thumbnail: m.thumbnail_file,
        settings: splitSettings(Object.fromEntries(Object.entries(m).filter(([k]) =>
          !/^(plater_id|plater_name|locked|thumbnail|top_file|pick_file|filament_map|filament_volume|pattern_bbox)/.test(k)))),
        slice: sliceInfo.get(index),
      };
      for (const mi of Array.from(pe.querySelectorAll('model_instance'))) {
        const im = readMetas(mi);
        const matches = objects.filter((o) => o.id === im.object_id && o.instance === Number(im.instance_id ?? 0));
        for (const o of matches) { o.plate = index; plate.objectUids.push(o.uid); }
      }
      plates.push(plate);
    });
    // Objects not listed anywhere: assign by position
    for (const o of objects) {
      if (o.plate !== null) continue;
      const x = o.transform[9], y = o.transform[10];
      const p = plates.find((pl) => x >= pl.offset[0] && x <= pl.offset[0] + bedInfo.width && y >= pl.offset[1] && y <= pl.offset[1] + bedInfo.depth);
      if (p) { o.plate = p.index; p.objectUids.push(o.uid); }
    }
  } else {
    const thumb = entries.find((e) => /thumbnail\.png$/i.test(e.path))?.path;
    plates.push({ index: 1, name: 'Platte 1', offset: [0, 0], objectUids: objects.map((o) => o.uid), thumbnail: thumb, settings: {}, slice: sliceInfo.get(1) });
    for (const o of objects) o.plate = 1;
  }
  plates.sort((a, b) => a.index - b.index);

  return {
    fileName, fileSize, slicer, unit: res.unit, metadata: res.metadata, settings, changedFromSystem,
    customGcodes: loadCustomGcodes(entries), objects, plates, bed: { ...bedInfo, gapFactor }, meshes, entries, parseMs: res.parseMs,
  };
}

export function loadFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
    file.arrayBuffer().then((buf) => {
      const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<{ ok: boolean; result?: WorkerResult; error?: string }>) => {
        worker.terminate();
        if (!ev.data.ok || !ev.data.result) return reject(new Error(ev.data.error ?? 'Unbekannter Fehler'));
        try { resolve(buildProject(ev.data.result, file.name, file.size)); } catch (e) { reject(e); }
      };
      worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Worker-Fehler')); };
      worker.postMessage(buf, [buf]);
    }, reject);
  });
}
