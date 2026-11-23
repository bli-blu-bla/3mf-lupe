import { isBambuLike } from './project';
import { first } from './settings';
import type { Project } from './types';

export interface Hint {
  level: 'info' | 'warn';
  title: string;
  body: string;
}

const HELPER_LABEL: Record<string, string> = {
  modifier: 'Modifier', negative: 'Negativ-Volumen', support_blocker: 'Stützen-Blocker', support_enforcer: 'Stützen-Erzwinger', other: 'Sonder-Teile',
};

const fmtMm = (n: number) => `${String(Math.round(n * 1000) / 1000).replace('.', ',')} mm`;

export function buildHints(p: Project): Hint[] {
  const out: Hint[] = [];
  const fam = p.slicer.family;
  const bambuLike = isBambuLike(fam);

  if (bambuLike && p.plates.length > 1) {
    out.push({
      level: 'warn',
      title: `${p.plates.length} Druckplatten in einer Datei`,
      body: 'PrusaSlicer und Cura kennen keine Platten aus Bambu Studio oder Orca und legen alle Objekte auf ein Bett, oft weit außerhalb. Exportiere die Platte, die du drucken willst, als STL (Menü „STL exportieren“) und lade nur diese.',
    });
  }

  if (bambuLike && fam !== 'orca') {
    out.push({
      level: 'info',
      title: 'In OrcaSlicer öffnen',
      body: 'OrcaSlicer liest Projekte aus Bambu Studio meist vollständig, auch Platten und Objekt-Einstellungen. Drucker- und Filamentprofile musst du dort trotzdem auf deine eigenen umstellen.',
    });
  }

  if (fam === 'prusa') {
    out.push({
      level: 'info',
      title: 'PrusaSlicer-Projekt in einem anderen Slicer',
      body: 'Bambu Studio und Orca fragen beim Öffnen, ob nur die Geometrie geladen werden soll. Wähle das. Die Druckeinstellungen aus dieser Datei findest du im Reiter „Druck“ und trägst sie in deinem Profil ein.',
    });
  }

  if (fam === 'cura') {
    out.push({
      level: 'info',
      title: 'Cura-Projekt',
      body: 'Cura speichert Profile als eigene Stapel, die andere Slicer nicht lesen. Die Geometrie kommt meist richtig an. Die Einstellungen stehen im Reiter „Druck“.',
    });
  }

  const overrides = p.objects.filter((o) => Object.keys(o.settings).length);
  if (overrides.length) {
    out.push({
      level: 'warn',
      title: `${overrides.length} ${overrides.length === 1 ? 'Objekt hat' : 'Objekte haben'} eigene Einstellungen`,
      body: `Zum Beispiel ${overrides.slice(0, 3).map((o) => `„${o.name}“`).join(', ')}. Solche Einstellungen pro Objekt gehen beim Wechsel des Slicers fast immer verloren. Im Reiter „Druck“ siehst du sie, wenn du das Objekt auswählst. Sie sind dort magenta markiert.`,
    });
  }

  const helperCounts = new Map<string, number>();
  for (const o of p.objects) for (const part of o.parts) if (part.kind !== 'model') helperCounts.set(part.kind, (helperCounts.get(part.kind) ?? 0) + 1);
  if (helperCounts.size) {
    const list = Array.from(helperCounts).map(([k, n]) => `${n}× ${HELPER_LABEL[k] ?? k}`).join(', ');
    out.push({
      level: 'warn',
      title: 'Hilfskörper im Modell',
      body: `${list}. Das sind keine druckbaren Teile, sondern Bereiche für andere Einstellungen. Beim STL-Export werden sie standardmäßig weggelassen. Ein Slicer ohne Unterstützung dafür würde sie sonst als massive Körper drucken.`,
    });
  }

  const paint = p.objects.reduce((a, o) => ({ s: a.s + o.paint.supports, c: a.c + o.paint.color, z: a.z + o.paint.seam }), { s: 0, c: 0, z: 0 });
  if (paint.s || paint.c || paint.z) {
    const what = [paint.s && 'Stützen', paint.c && 'Farben (Multimaterial)', paint.z && 'Nahtposition'].filter(Boolean).join(', ');
    out.push({
      level: 'warn',
      title: 'Aufgemalte Bereiche',
      body: `In der Datei sind ${what} direkt aufs Modell gemalt. Eine STL enthält das nicht. Wer anderswo druckt, muss die Bereiche neu malen.`,
    });
  }

  const supType = first(p.settings.support_type);
  const supOn = /^(1|true)$/i.test(first(p.settings.support_material ?? p.settings.enable_support) ?? '');
  const manualPrusa = supOn && first(p.settings.support_material_auto) === '0';
  const manualBambu = supOn && !!supType && /manual/.test(supType);
  if (manualPrusa || manualBambu) {
    const setting = manualPrusa
      ? 'ist „Stützmaterial erzeugen“ an und „Automatisch erzeugte Stützen“ aus'
      : `stehen die Stützen auf „${supType!.startsWith('tree') ? 'Baum' : 'Normal'} (manuell)“`;
    out.push({
      level: 'warn',
      title: 'Stützen nur an gemalten Stellen',
      body: `In dieser Datei ${setting}. Es entstehen also nur dort Stützen, wo der Ersteller sie aufgemalt hat${paint.s ? ` (${paint.s.toLocaleString('de-DE')} Flächen, im Viewer grün)` : ''}. Übernimmt dein Slicer die Bemalung nicht, druckt er entweder ganz ohne Stützen oder mit automatischen Stützen überall.`,
    });
  }

  const codes = p.customGcodes;
  if (codes.length) {
    const label: Record<string, string> = { color: 'Farbwechsel', pause: 'Pause', custom: 'eigener G-Code', template: 'Vorlage', tool: 'Werkzeugwechsel' };
    const list = codes.slice(0, 6).map((c) => `${label[c.kind]} bei ${String(Math.round(c.z * 100) / 100).replace('.', ',')} mm${c.plate && p.plates.length > 1 ? ` (Platte ${c.plate})` : ''}`).join(', ');
    out.push({
      level: 'warn',
      title: `${codes.length} ${codes.length === 1 ? 'Ereignis' : 'Ereignisse'} während des Drucks`,
      body: `${list}${codes.length > 6 ? ' und weitere' : ''}. STL-Dateien und andere Slicer übernehmen das nicht. Setze die Farbwechsel oder Pausen in deinem Slicer bei denselben Höhen neu. Die vollständige Liste steht im Reiter „Filament“.`,
    });
  }

  const sources = new Set<string>();
  for (const o of p.objects) for (const part of o.parts) if (part.sourceFile) sources.add(part.sourceFile);
  if (sources.size) {
    const names = Array.from(sources);
    out.push({
      level: 'info',
      title: 'Ursprünglich aus einer anderen Datei importiert',
      body: `Die Geometrie stammt aus ${names.slice(0, 3).map((n) => `„${n}“`).join(', ')}${names.length > 3 ? ' und weiteren' : ''}. Sie wurde in ${p.slicer.name} geladen und neu gespeichert. Der Dateiname verrät oft, für welchen Drucker oder Slicer das Modell ursprünglich gedacht war.`,
    });
  }

  const profiled = p.objects.filter((o) => o.layerProfile);
  if (profiled.length) {
    out.push({
      level: 'info',
      title: 'Variable Schichthöhe',
      body: `${profiled.map((o) => `„${o.name}“`).slice(0, 3).join(', ')} ${profiled.length === 1 ? 'hat' : 'haben'} eine variable Schichthöhe (${profiled.map((o) => `${fmtMm(o.layerProfile!.min)}–${fmtMm(o.layerProfile!.max)}`)[0]}). Dieses Profil geht beim Wechsel des Slicers verloren.`,
    });
  }

  const multi = new Set(p.objects.map((o) => o.extruder));
  for (const o of p.objects) for (const pt of o.parts) if (pt.extruder) multi.add(pt.extruder);
  if (multi.size > 1) {
    out.push({
      level: 'info',
      title: `${multi.size} Filamente zugewiesen`,
      body: 'Die Objekte sind auf mehrere Filamente bzw. Farben verteilt. Mit nur einer Spule druckst du sie einfach nacheinander. Welches Objekt welches Filament nutzt, steht im Reiter „Objekte“.',
    });
  }

  if (p.unit !== 'millimeter') {
    out.push({ level: 'warn', title: `Einheit: ${p.unit}`, body: 'Das Modell ist nicht in Millimetern gespeichert. Beim STL-Export wird auf Millimeter umgerechnet.' });
  }

  const gcode = p.entries.filter((e) => /\.gcode$/i.test(e.path));
  if (gcode.length) {
    out.push({
      level: 'warn',
      title: 'Fertig geslicter G-Code enthalten',
      body: `Die Datei enthält ${gcode.length} G-Code-Datei(en) für „${first(p.settings.printer_model) ?? first(p.settings.printer_settings_id) ?? 'einen bestimmten Drucker'}“. Drucke diesen G-Code nur auf genau diesem Drucker. Für alle anderen Drucker musst du neu slicen.`,
    });
  }

  if (!p.objects.length) {
    out.push({ level: 'warn', title: 'Keine Objekte gefunden', body: 'Im Bauplan der Datei stehen keine Objekte. Vielleicht ist sie unvollständig gespeichert.' });
  }
  return out;
}
