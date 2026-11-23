/** 3MF affine transform, 12 numbers, row-vector convention (p' = p · M). */
export type Mat12 = number[];

export const IDENTITY: Mat12 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export interface PaintStats {
  supports: number;
  seam: number;
  color: number;
}

export interface RawMesh {
  positions: Float32Array;
  indices: Uint32Array;
  paint: PaintStats;
  /** per triangle: 0 none, 1 enforcer, 2 blocker */
  paintSupports?: Uint8Array;
  /** per triangle: 0 = object filament, n = filament n */
  paintColors?: Uint8Array;
}

export interface RawComponent {
  path: string;
  objectid: string;
  transform: Mat12;
}

export interface RawObject {
  key: string; // `${path}#${id}`
  id: string;
  path: string;
  type: string;
  name?: string;
  mesh?: RawMesh;
  components: RawComponent[];
}

export interface RawBuildItem {
  objectid: string;
  transform: Mat12;
  printable: boolean;
}

export interface ArchiveEntry {
  path: string;
  size: number;
  data: Uint8Array;
}

export interface WorkerResult {
  mainPath: string;
  unit: string;
  metadata: Record<string, string>;
  objects: RawObject[];
  build: RawBuildItem[];
  entries: ArchiveEntry[];
  parseMs: number;
}

export type PartKind = 'model' | 'modifier' | 'negative' | 'support_blocker' | 'support_enforcer' | 'other';

/** A geometry piece belonging to a print object. */
export interface Part {
  name: string;
  kind: PartKind;
  meshKey: string;
  triStart: number; // inclusive, in triangles
  triEnd: number; // exclusive
  matrix: Mat12; // part -> object space
  sourceFile?: string;
  settings: Record<string, string>;
  extruder?: number;
}

export interface PrintObject {
  uid: string;
  id: string;
  name: string;
  instance: number;
  plate: number | null;
  transform: Mat12; // object -> world
  parts: Part[];
  settings: Record<string, string>;
  extruder: number;
  printable: boolean;
  triangles: number;
  paint: PaintStats;
  layerRanges: { from: number; to: number; settings: Record<string, string> }[];
  /** variable layer height profile, if the object has one */
  layerProfile?: { min: number; max: number; points: number };
}

export type CustomGcodeKind = 'color' | 'pause' | 'custom' | 'template' | 'tool';

export interface CustomGcode {
  plate: number | null;
  z: number;
  kind: CustomGcodeKind;
  extruder?: number;
  color?: string;
  gcode?: string;
  extra?: string;
}

export interface Plate {
  index: number; // 1-based
  name: string;
  offset: [number, number];
  objectUids: string[];
  thumbnail?: string; // archive path
  settings: Record<string, string>;
  slice?: SliceInfo;
}

export interface SliceInfo {
  prediction?: number; // seconds
  weight?: number; // grams
  filaments: { id: string; type?: string; color?: string; usedM?: number; usedG?: number }[];
}

export type SlicerFamily = 'bambu' | 'orca' | 'prusa' | 'cura' | 'creality' | 'anycubic' | 'generic';

export interface SlicerInfo {
  family: SlicerFamily;
  name: string;
  version: string;
  application: string;
}

export type Settings = Record<string, string | string[]>;

export interface Project {
  fileName: string;
  fileSize: number;
  slicer: SlicerInfo;
  unit: string;
  metadata: Record<string, string>;
  settings: Settings;
  /** keys that differ from the slicer's system profile (Bambu/Orca only) */
  changedFromSystem: Set<string>;
  customGcodes: CustomGcode[];
  objects: PrintObject[];
  plates: Plate[];
  bed: { shape: [number, number][]; width: number; depth: number; gapFactor: number };
  meshes: Map<string, RawMesh>;
  entries: ArchiveEntry[];
  parseMs: number;
}
