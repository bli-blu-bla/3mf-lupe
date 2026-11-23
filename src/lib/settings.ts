import type { PrintObject, Project, Settings } from './types';

export type Fmt = 'mm' | 'mm/s' | 'mm/s²' | '°C' | '%' | '°' | 'bool' | 'enum' | 'n' | 'text' | 'g/cm³' | 'mm³/s' | '€/kg';

export interface Spec {
  id: string;
  label: string;
  keys: string[];
  fmt: Fmt;
  hint?: string;
}

export interface Group {
  id: string;
  title: string;
  specs: Spec[];
}

export const GROUPS: Group[] = [
  {
    id: 'printer', title: 'Drucker & Profil', specs: [
      { id: 'printer', label: 'Drucker', keys: ['printer_settings_id', 'printer_model', 'machine_name', 'printer_name'], fmt: 'text' },
      { id: 'nozzle', label: 'Düse', keys: ['nozzle_diameter', 'machine_nozzle_size'], fmt: 'mm' },
      { id: 'physical', label: 'Physischer Drucker', keys: ['physical_printer_settings_id'], fmt: 'text' },
      { id: 'profile', label: 'Druckprofil', keys: ['print_settings_id', 'quality_name'], fmt: 'text' },
      { id: 'bedtype', label: 'Druckplatte', keys: ['curr_bed_type', 'bed_custom_texture'], fmt: 'enum' },
      { id: 'gcode', label: 'G-Code-Variante', keys: ['gcode_flavor', 'machine_gcode_flavor'], fmt: 'enum' },
    ],
  },
  {
    id: 'quality', title: 'Schichten & Qualität', specs: [
      { id: 'layer', label: 'Schichthöhe', keys: ['layer_height'], fmt: 'mm' },
      { id: 'layer0', label: 'Erste Schicht', keys: ['initial_layer_print_height', 'first_layer_height', 'layer_height_0'], fmt: 'mm' },
      { id: 'lw', label: 'Linienbreite', keys: ['line_width', 'extrusion_width', 'wall_line_width'], fmt: 'mm' },
      { id: 'seam', label: 'Naht', keys: ['seam_position', 'z_seam_type'], fmt: 'enum' },
      { id: 'adaptive', label: 'Variable Schichthöhe', keys: ['adaptive_layer_height', 'adaptive_layer_height_enabled'], fmt: 'bool' },
      { id: 'ironing', label: 'Bügeln', keys: ['ironing', 'ironing_type', 'ironing_enabled'], fmt: 'enum' },
      { id: 'fuzzy', label: 'Fuzzy Skin', keys: ['fuzzy_skin', 'magic_fuzzy_skin_enabled'], fmt: 'enum' },
      { id: 'vase', label: 'Vasenmodus', keys: ['spiral_mode', 'spiral_vase', 'magic_spiralize'], fmt: 'bool' },
    ],
  },
  {
    id: 'shell', title: 'Wände & Oberflächen', specs: [
      { id: 'walls', label: 'Wandlinien', keys: ['wall_loops', 'perimeters', 'wall_line_count'], fmt: 'n' },
      { id: 'top', label: 'Deckschichten', keys: ['top_shell_layers', 'top_solid_layers', 'top_layers'], fmt: 'n' },
      { id: 'bottom', label: 'Bodenschichten', keys: ['bottom_shell_layers', 'bottom_solid_layers', 'bottom_layers'], fmt: 'n' },
      { id: 'topmin', label: 'Mindestdicke oben', keys: ['top_shell_thickness', 'top_solid_min_thickness', 'top_thickness'], fmt: 'mm' },
      { id: 'botmin', label: 'Mindestdicke unten', keys: ['bottom_shell_thickness', 'bottom_solid_min_thickness', 'bottom_thickness'], fmt: 'mm' },
      { id: 'toppat', label: 'Muster oben', keys: ['top_surface_pattern', 'top_fill_pattern', 'top_bottom_pattern'], fmt: 'enum' },
      { id: 'botpat', label: 'Muster unten', keys: ['bottom_surface_pattern', 'bottom_fill_pattern', 'top_bottom_pattern_0'], fmt: 'enum' },
      { id: 'order', label: 'Wandreihenfolge', keys: ['wall_sequence', 'external_perimeters_first', 'outer_inset_first'], fmt: 'enum' },
    ],
  },
  {
    id: 'infill', title: 'Infill', specs: [
      { id: 'density', label: 'Dichte', keys: ['sparse_infill_density', 'fill_density', 'infill_sparse_density'], fmt: '%' },
      { id: 'pattern', label: 'Muster', keys: ['sparse_infill_pattern', 'fill_pattern', 'infill_pattern'], fmt: 'enum' },
      { id: 'angle', label: 'Winkel', keys: ['infill_direction', 'fill_angle', 'infill_angles'], fmt: '°' },
      { id: 'overlap', label: 'Überlappung mit Wand', keys: ['infill_wall_overlap', 'infill_overlap', 'infill_overlap'], fmt: '%' },
      { id: 'combine', label: 'Infill kombinieren', keys: ['infill_combination', 'infill_every_layers', 'infill_sparse_thickness'], fmt: 'text' },
      { id: 'anchor', label: 'Anker-Länge', keys: ['infill_anchor', 'infill_anchor_max'], fmt: 'text' },
    ],
  },
  {
    id: 'support', title: 'Stützen', specs: [
      { id: 'sup', label: 'Stützen aktiv', keys: ['enable_support', 'support_material', 'support_enable'], fmt: 'bool' },
      { id: 'suptype', label: 'Art', keys: ['support_type', 'support_material_style', 'support_structure'], fmt: 'enum' },
      { id: 'supauto', label: 'Automatisch erzeugt', keys: ['support_material_auto'], fmt: 'bool' },
      { id: 'supangle', label: 'Überhang-Schwelle', keys: ['support_threshold_angle', 'support_material_threshold', 'support_angle'], fmt: '°' },
      { id: 'suppaint', label: 'Nur gemalte Stützen', keys: ['@painted'], fmt: 'text' },
      { id: 'supbed', label: 'Nur auf Druckplatte', keys: ['support_on_build_plate_only', 'support_material_buildplate_only', 'support_type_buildplate'], fmt: 'bool' },
      { id: 'supz', label: 'Abstand Z oben', keys: ['support_top_z_distance', 'support_material_contact_distance', 'support_top_distance'], fmt: 'mm' },
      { id: 'supif', label: 'Interface-Schichten', keys: ['support_interface_top_layers', 'support_material_interface_layers', 'support_interface_height'], fmt: 'n' },
    ],
  },
  {
    id: 'adhesion', title: 'Haftung', specs: [
      { id: 'adh', label: 'Haftungshilfe', keys: ['adhesion_type'], fmt: 'enum' },
      { id: 'brim', label: 'Brim', keys: ['brim_type'], fmt: 'enum' },
      { id: 'brimw', label: 'Brim-Breite', keys: ['brim_width', 'brim_line_count'], fmt: 'mm' },
      { id: 'skirt', label: 'Skirt-Runden', keys: ['skirt_loops', 'skirts', 'skirt_line_count'], fmt: 'n' },
      { id: 'raft', label: 'Raft-Schichten', keys: ['raft_layers'], fmt: 'n' },
      { id: 'elephant', label: 'Elefantenfuß-Kompensation', keys: ['elefant_foot_compensation', 'elephant_foot_compensation', 'xy_offset_layer_0'], fmt: 'mm' },
    ],
  },
  {
    id: 'temp', title: 'Temperaturen', specs: [
      { id: 'tnoz', label: 'Düse', keys: ['nozzle_temperature', 'temperature', 'material_print_temperature'], fmt: '°C' },
      { id: 'tnoz0', label: 'Düse erste Schicht', keys: ['nozzle_temperature_initial_layer', 'first_layer_temperature', 'material_print_temperature_layer_0'], fmt: '°C' },
      { id: 'tbed', label: 'Bett', keys: ['@bed', 'bed_temperature', 'material_bed_temperature'], fmt: '°C' },
      { id: 'tbed0', label: 'Bett erste Schicht', keys: ['@bed0', 'first_layer_bed_temperature', 'material_bed_temperature_layer_0'], fmt: '°C' },
      { id: 'tchamber', label: 'Bauraum', keys: ['chamber_temperatures', 'chamber_temperature', 'build_volume_temperature'], fmt: '°C' },
    ],
  },
  {
    id: 'speed', title: 'Geschwindigkeiten', specs: [
      { id: 'souter', label: 'Außenwand', keys: ['outer_wall_speed', 'external_perimeter_speed', 'speed_wall_0'], fmt: 'mm/s' },
      { id: 'sinner', label: 'Innenwand', keys: ['inner_wall_speed', 'perimeter_speed', 'speed_wall_x'], fmt: 'mm/s' },
      { id: 'sinfill', label: 'Infill', keys: ['sparse_infill_speed', 'infill_speed', 'speed_infill'], fmt: 'mm/s' },
      { id: 'stop', label: 'Oberfläche', keys: ['top_surface_speed', 'top_solid_infill_speed', 'speed_topbottom'], fmt: 'mm/s' },
      { id: 'sfirst', label: 'Erste Schicht', keys: ['initial_layer_speed', 'first_layer_speed', 'speed_layer_0'], fmt: 'mm/s' },
      { id: 'stravel', label: 'Eilgang', keys: ['travel_speed', 'speed_travel'], fmt: 'mm/s' },
      { id: 'accel', label: 'Beschleunigung', keys: ['default_acceleration', 'machine_acceleration', 'acceleration_print'], fmt: 'mm/s²' },
    ],
  },
  {
    id: 'cooling', title: 'Kühlung & Rückzug', specs: [
      { id: 'fanmax', label: 'Lüfter max.', keys: ['fan_max_speed', 'max_fan_speed', 'cool_fan_speed_max'], fmt: '%' },
      { id: 'fanmin', label: 'Lüfter min.', keys: ['fan_min_speed', 'min_fan_speed', 'cool_fan_speed_min'], fmt: '%' },
      { id: 'nofan', label: 'Ohne Lüfter (erste Schichten)', keys: ['close_fan_the_first_x_layers', 'disable_fan_first_layers', 'cool_fan_full_layer'], fmt: 'n' },
      { id: 'retl', label: 'Rückzug Länge', keys: ['retraction_length', 'retract_length', 'retraction_amount'], fmt: 'mm' },
      { id: 'rets', label: 'Rückzug Tempo', keys: ['retraction_speed', 'retract_speed', 'retraction_speed'], fmt: 'mm/s' },
      { id: 'zhop', label: 'Z-Hop', keys: ['z_hop', 'retract_lift', 'retraction_hop'], fmt: 'mm' },
    ],
  },
];

/** Keys that appear in the spec, used to tell "known" from "other" settings. */
export const KNOWN_KEYS = new Set(GROUPS.flatMap((g) => g.specs.flatMap((s) => s.keys)));

const BED_TEMP_KEY: Record<string, string> = {
  'Cool Plate': 'cool_plate_temp',
  'Engineering Plate': 'eng_plate_temp',
  'High Temp Plate': 'hot_plate_temp',
  'Textured PEI Plate': 'textured_plate_temp',
  'Smooth PEI Plate': 'hot_plate_temp',
  'Supertack Plate': 'supertack_plate_temp',
  'Textured Cool Plate': 'textured_cool_plate_temp',
};

export function first(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Resolve a spec against settings; returns the key that matched and its value. */
export function resolve(spec: Spec, s: Settings): { key: string; value: string | string[] } | null {
  for (const k of spec.keys) {
    if (k === '@painted') {
      // PrusaSlicer: support_material on + auto off; Bambu/Orca: support_type "...(manual)"
      const on = first(s.support_material ?? s.enable_support);
      if (on === undefined || !/^(1|true)$/i.test(on)) return null;
      if (first(s.support_material_auto) === '0') return { key: 'support_material_auto', value: 'Ja, Stützen entstehen nur an aufgemalten Stellen' };
      const t = first(s.support_type);
      if (t && /manual/.test(t)) return { key: 'support_type', value: 'Ja, Stützen entstehen nur an aufgemalten Stellen' };
      return null;
    }
    if (k === '@bed' || k === '@bed0') {
      const bt = first(s.curr_bed_type);
      const base = bt ? BED_TEMP_KEY[bt] : undefined;
      const key = base ? (k === '@bed0' ? `${base}_initial_layer` : base) : undefined;
      if (key && s[key] !== undefined) return { key, value: s[key] };
      continue;
    }
    if (s[k] !== undefined && s[k] !== '') return { key: k, value: s[k] };
  }
  return null;
}

/** Merge project settings with object overrides (object wins). */
export function effectiveSettings(project: Project, obj?: PrintObject | null): Settings {
  if (!obj) return project.settings;
  return { ...project.settings, ...obj.settings };
}

const ENUM_DE: Record<string, string> = {
  // infill / surface patterns
  rectilinear: 'Rechtlinig', 'zig-zag': 'Zickzack', zigzag: 'Zickzack', lines: 'Linien', line: 'Linien', grid: 'Gitter',
  triangles: 'Dreiecke', 'tri-hexagon': 'Tri-Hexagon', trihexagon: 'Tri-Hexagon', stars: 'Sterne', cubic: 'Kubisch',
  adaptivecubic: 'Adaptiv kubisch', 'adaptive-cubic': 'Adaptiv kubisch', quartercubic: 'Viertel-kubisch',
  supportcubic: 'Stütz-kubisch', 'support-cubic': 'Stütz-kubisch', lightning: 'Blitz', honeycomb: 'Waben',
  '3dhoneycomb': '3D-Waben', gyroid: 'Gyroid', hilbertcurve: 'Hilbert-Kurve', archimedeanchords: 'Archimedische Sehnen',
  octagramspiral: 'Oktagramm-Spirale', concentric: 'Konzentrisch', monotonic: 'Monoton', monotonicline: 'Monotone Linie',
  monotoniclines: 'Monotone Linien', alignedrectilinear: 'Ausgerichtet rechtlinig', crosshatch: 'Kreuzschraffur',
  cross: 'Kreuz', cross_3d: 'Kreuz 3D', tetrahedral: 'Tetraeder', octet: 'Oktett', 'cross-hatch': 'Kreuzschraffur',
  'quarter-cubic': 'Viertel-kubisch', concentricinternal: 'Konzentrisch innen',
  // seams
  aligned: 'Ausgerichtet', nearest: 'Nächste', random: 'Zufällig', rear: 'Hinten', back: 'Hinten', sharpest_corner: 'Schärfste Ecke', shortest: 'Kürzeste',
  // support / adhesion
  normal: 'Normal', 'normal(auto)': 'Normal (automatisch)', 'normal(manual)': 'Normal (nur gemalt)', 'tree(auto)': 'Baum (automatisch)',
  'tree(manual)': 'Baum (nur gemalt)', tree: 'Baum', organic: 'Organisch', snug: 'Eng anliegend', grid_support: 'Gitter',
  no_brim: 'Kein Brim', outer_only: 'Nur außen', inner_only: 'Nur innen', outer_and_inner: 'Außen und innen', auto_brim: 'Automatisch',
  brim_ears: 'Brim-Ohren', painted: 'Gemalt', none: 'Keine', skirt: 'Skirt', brim: 'Brim', raft: 'Raft',
  // walls
  'inner wall/outer wall': 'Innen, dann außen', 'outer wall/inner wall': 'Außen, dann innen', 'inner-outer-inner wall': 'Innen-außen-innen',
  // ironing / fuzzy
  no_ironing: 'Aus', 'no ironing': 'Aus', top: 'Oberste Fläche', topmost: 'Oberste Schicht', solid: 'Alle festen Flächen', external: 'Außen', all: 'Alle', allwalls: 'Alle Wände',
};

export function translateEnum(v: string): string {
  return ENUM_DE[v] ?? ENUM_DE[v.toLowerCase()] ?? v;
}

const BOOLISH = /^(1|0|true|false)$/i;

export function formatValue(raw: string | string[], fmt: Fmt, key?: string): string {
  const parts = Array.isArray(raw) ? raw : [raw];
  const uniq = Array.from(new Set(parts.map((p) => p.trim())));
  const one = (v: string): string => {
    const clean = v.replace(/^"|"$/g, '');
    if (key === 'external_perimeters_first' || key === 'outer_inset_first') return clean === '1' || clean === 'True' || clean === 'true' ? 'Außen zuerst' : 'Innen zuerst';
    if (fmt === 'bool' || (BOOLISH.test(clean) && fmt !== 'n' && fmt !== '°C' && fmt !== 'mm' && fmt !== 'mm/s' && fmt !== '%')) {
      if (/^(1|true)$/i.test(clean)) return 'Ja';
      if (/^(0|false)$/i.test(clean)) return 'Nein';
    }
    if (fmt === 'enum') return translateEnum(clean);
    if (fmt === 'text') return clean;
    if (clean.endsWith('%')) return clean.replace('.', ',').replace(/(\d)%$/, '$1 %');
    if (fmt === '%' && /^0?\.\d+$/.test(clean)) return `${Math.round(Number(clean) * 100)} %`;
    const n = Number(clean);
    if (clean !== '' && Number.isFinite(n)) {
      const s = String(Math.round(n * 1000) / 1000).replace('.', ',');
      return fmt === 'n' ? s : `${s} ${fmt}`;
    }
    return clean;
  };
  return uniq.map(one).join(' / ');
}

/* ---------- filaments ---------- */

export interface Filament {
  index: number;
  name: string;
  type: string;
  vendor: string;
  color: string;
  rows: { label: string; value: string; key: string }[];
}

function pick(s: Settings, key: string, i: number): string | undefined {
  const v = s[key];
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[i] ?? v[0];
  const split = v.includes(';') ? v.split(';') : key.includes('colour') || key.includes('color') ? [v] : v.split(',');
  return (split[i] ?? split[0])?.replace(/^"|"$/g, '').trim();
}

const FIL_ROWS: { label: string; keys: string[]; fmt: Fmt }[] = [
  { label: 'Düse', keys: ['nozzle_temperature', 'temperature', 'material_print_temperature'], fmt: '°C' },
  { label: 'Düse erste Schicht', keys: ['nozzle_temperature_initial_layer', 'first_layer_temperature'], fmt: '°C' },
  { label: 'Bett', keys: ['@bed', 'bed_temperature', 'material_bed_temperature'], fmt: '°C' },
  { label: 'Bett erste Schicht', keys: ['@bed0', 'first_layer_bed_temperature'], fmt: '°C' },
  { label: 'Durchmesser', keys: ['filament_diameter', 'material_diameter'], fmt: 'mm' },
  { label: 'Dichte', keys: ['filament_density', 'material_density'], fmt: 'g/cm³' },
  { label: 'Flussrate', keys: ['filament_flow_ratio', 'extrusion_multiplier', 'material_flow'], fmt: 'n' },
  { label: 'Max. Volumenstrom', keys: ['filament_max_volumetric_speed', 'max_volumetric_speed'], fmt: 'mm³/s' },
  { label: 'Rückzug', keys: ['filament_retraction_length', 'filament_retract_length'], fmt: 'mm' },
  { label: 'Lüfter max.', keys: ['fan_max_speed', 'max_fan_speed'], fmt: '%' },
  { label: 'Lüfter min.', keys: ['fan_min_speed', 'min_fan_speed'], fmt: '%' },
  { label: 'Preis', keys: ['filament_cost', 'material_cost'], fmt: '€/kg' },
  { label: 'Pressure Advance', keys: ['pressure_advance'], fmt: 'n' },
];

export function filaments(s: Settings): Filament[] {
  const colors = s.filament_colour ?? s.extruder_colour ?? s.material_colour;
  let count = 1;
  if (Array.isArray(colors)) count = colors.length;
  else if (typeof colors === 'string') count = colors.split(';').length;
  if (Array.isArray(s.filament_settings_id)) count = Math.max(count, s.filament_settings_id.length);
  const out: Filament[] = [];
  for (let i = 0; i < count; i++) {
    const rows: Filament['rows'] = [];
    for (const r of FIL_ROWS) {
      for (const k of r.keys) {
        let key = k;
        if (k === '@bed' || k === '@bed0') {
          const bt = first(s.curr_bed_type);
          const base = bt ? BED_TEMP_KEY[bt] : undefined;
          if (!base) continue;
          key = k === '@bed0' ? `${base}_initial_layer` : base;
        }
        const v = pick(s, key, i);
        if (v !== undefined && v !== '' && v !== 'nil') {
          rows.push({ label: r.label, key, value: formatValue(v, r.fmt) });
          break;
        }
      }
    }
    const color = pick(s, 'filament_colour', i) ?? pick(s, 'extruder_colour', i) ?? pick(s, 'material_colour', i) ?? '#9AA19D';
    out.push({
      index: i + 1,
      name: pick(s, 'filament_settings_id', i) ?? pick(s, 'material_name', i) ?? `Filament ${i + 1}`,
      type: pick(s, 'filament_type', i) ?? pick(s, 'material_type', i) ?? '',
      vendor: pick(s, 'filament_vendor', i) ?? pick(s, 'material_brand', i) ?? '',
      color: /^#[0-9a-f]{6,8}$/i.test(color) ? color.slice(0, 7) : '#9AA19D',
      rows,
    });
  }
  return out;
}

/** Numeric helpers for the cross-section drawing */
export function num(v: string | string[] | undefined, fallback: number): number {
  const s = first(v);
  if (s === undefined) return fallback;
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

export function percent(v: string | string[] | undefined, fallback: number): number {
  const s = first(v);
  if (s === undefined) return fallback;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return fallback;
  return s.includes('%') || n > 1 ? n / 100 : n;
}
