import DOMPurify from 'dompurify';
import { useMemo, useState } from 'react';
import { exportObjectStl, download, safeName } from '../lib/export';
import type { Hint } from '../lib/hints';
import { entryText } from '../lib/project';
import {
  GROUPS, KNOWN_KEYS, effectiveSettings, filaments, first, formatValue, resolve, type Filament,
} from '../lib/settings';
import type { ArchiveEntry, PartKind, PrintObject, Project } from '../lib/types';
import CrossSection from './CrossSection';

export const KIND_LABEL: Record<PartKind, string> = {
  model: 'Teil', modifier: 'Modifier', negative: 'Negativ-Volumen', support_blocker: 'Stützen-Blocker', support_enforcer: 'Stützen-Erzwinger', other: 'Sonderteil',
};

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

function fmtDims(d?: number[]) {
  if (!d) return '';
  return d.map((v) => (Math.round(v * 10) / 10).toString().replace('.', ',')).join(' × ') + ' mm';
}

function mm(n: number) {
  return `${String(Math.round(n * 1000) / 1000).replace('.', ',')} mm`;
}

function fmtTime(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

/* ---------------- Objekte ---------------- */

export function ObjectsPanel({ project, objects, selected, onSelect, colors, dims, includeHelpers }: {
  project: Project; objects: PrintObject[]; selected: string | null; onSelect: (uid: string | null) => void;
  colors: string[]; dims: Map<string, number[]>; includeHelpers: boolean;
}) {
  if (!objects.length) return <p className="empty-note">Auf dieser Platte liegen keine Objekte.</p>;
  return (
    <ul className="objlist">
      {objects.map((o) => {
        const isSel = o.uid === selected;
        const helpers = o.parts.filter((p) => p.kind !== 'model').length;
        const overrides = Object.keys(o.settings).length;
        return (
          <li key={o.uid} className={`obj${isSel ? ' is-selected' : ''}${o.printable ? '' : ' is-off'}`}>
            <button className="obj-main" onClick={() => onSelect(isSel ? null : o.uid)} aria-pressed={isSel}>
              <span className="swatch" style={{ background: colors[o.extruder - 1] ?? colors[0] }} title={`Filament ${o.extruder}`}>{o.extruder}</span>
              <span className="obj-text">
                <span className="obj-name">{o.name}</span>
                <span className="obj-meta">
                  {fmtDims(dims.get(o.uid))}
                  {project.plates.length > 1 && o.plate ? `, Platte ${o.plate}` : ''}
                  {!o.printable && ', nicht druckbar markiert'}
                </span>
              </span>
              {overrides > 0 && <span className="badge badge-override" title="Hat eigene Druckeinstellungen">{overrides} eigene</span>}
            </button>
            <button className="btn btn-small" onClick={() => exportObjectStl(project, o, { includeHelpers })}>STL</button>
            {isSel && (
              <div className="obj-detail">
                <dl className="kv">
                  <dt>Dreiecke</dt><dd>{o.triangles.toLocaleString('de-DE')}</dd>
                  <dt>Teile</dt><dd>{o.parts.length}{helpers ? `, davon ${helpers} Hilfskörper` : ''}</dd>
                  {o.layerProfile && (<><dt>Schichthöhe</dt><dd>variabel, {mm(o.layerProfile.min)} bis {mm(o.layerProfile.max)}</dd></>)}
                  {o.layerRanges.length > 0 && (<><dt>Höhenbereiche</dt><dd>{o.layerRanges.length} mit eigenen Einstellungen</dd></>)}
                  {(() => {
                    const src = Array.from(new Set(o.parts.map((p) => p.sourceFile).filter(Boolean)));
                    return src.length ? (<><dt>Importiert aus</dt><dd>{src.join(', ')}</dd></>) : null;
                  })()}
                  {o.paint.supports + o.paint.color + o.paint.seam > 0 && (
                    <><dt>Bemalt</dt><dd>{[o.paint.supports && `${o.paint.supports.toLocaleString('de-DE')} Flächen Stützen`, o.paint.color && `${o.paint.color.toLocaleString('de-DE')} Flächen Farbe`, o.paint.seam && `${o.paint.seam.toLocaleString('de-DE')} Flächen Naht`].filter(Boolean).join(', ')}</dd></>
                  )}
                </dl>
                {o.parts.length > 1 && (
                  <ul className="parts">
                    {o.parts.map((p, i) => (
                      <li key={i} className={`part part-${p.kind}`}>
                        <span className="part-kind">{KIND_LABEL[p.kind]}</span>
                        <span className="part-name">{p.name}</span>
                        {Object.keys(p.settings).length > 0 && <span className="badge badge-override">{Object.keys(p.settings).length} eigene</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Druck ---------------- */

export function PrintPanel({ project, selectedObj, onClear, color }: { project: Project; selectedObj: PrintObject | null; onClear: () => void; color: string }) {
  const [q, setQ] = useState('');
  const eff = effectiveSettings(project, selectedObj);
  const overrides = new Set(Object.keys(selectedObj?.settings ?? {}));
  const allKeys = Object.keys(eff).sort();
  const filtered = q ? allKeys.filter((k) => k.toLowerCase().includes(q.toLowerCase()) || String(eff[k]).toLowerCase().includes(q.toLowerCase())) : allKeys;
  const hasAny = Object.keys(project.settings).length > 0;
  const objectsWithOverrides = project.objects.filter((o) => Object.keys(o.settings).length);

  return (
    <div className="print">
      <div className="scope">
        {selectedObj ? (
          <>
            <span>Werte für <strong>{selectedObj.name}</strong></span>
            <button className="link" onClick={onClear}>Projekt-Werte zeigen</button>
          </>
        ) : (
          <span>Werte für das ganze Projekt. {objectsWithOverrides.length > 0 ? `${objectsWithOverrides.length} Objekte haben eigene Werte, wähle eins aus.` : 'Wähle ein Objekt, um seine Werte zu sehen.'}</span>
        )}
      </div>

      {!hasAny && (
        <p className="empty-note">In dieser Datei sind keine Slicer-Einstellungen gespeichert. Es ist eine reine Geometrie-3MF.</p>
      )}

      {hasAny && <CrossSection settings={eff} color={color} overrides={overrides} />}

      {hasAny && GROUPS.map((g) => {
        const rows = g.specs.map((spec) => ({ spec, r: resolve(spec, eff) })).filter((x) => x.r);
        if (!rows.length) return null;
        return (
          <section key={g.id} className="sgroup">
            <h3>{g.title}</h3>
            <dl className="srows">
              {rows.map(({ spec, r }) => {
                const isOv = overrides.has(r!.key);
                const changed = project.changedFromSystem.has(r!.key);
                return (
                  <div key={spec.id} className={`srow${isOv ? ' is-override' : ''}`}>
                    <dt title={r!.key}>{spec.label}</dt>
                    <dd>
                      {formatValue(r!.value, spec.fmt, r!.key)}
                      {isOv && <span className="tag">Objekt</span>}
                      {!isOv && changed && <span className="tag tag-changed" title="Weicht vom Systemprofil des Slicers ab">angepasst</span>}
                      {isOv && <span className="was">Projekt: {formatValue(project.settings[r!.key] ?? '–', spec.fmt, r!.key)}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        );
      })}

      {selectedObj?.layerProfile && (
        <section className="sgroup">
          <h3>Variable Schichthöhe</h3>
          <p className="note">Dieses Objekt hat ein eigenes Höhenprofil mit {selectedObj.layerProfile.points} Stützpunkten. Die Schichthöhe liegt zwischen {mm(selectedObj.layerProfile.min)} und {mm(selectedObj.layerProfile.max)}, statt überall {formatValue(project.settings.layer_height ?? '', 'mm')}.</p>
        </section>
      )}

      {selectedObj && selectedObj.layerRanges.length > 0 && (
        <section className="sgroup">
          <h3>Höhenbereiche</h3>
          {selectedObj.layerRanges.map((r, i) => (
            <div key={i} className="range">
              <strong>{String(r.from).replace('.', ',')}–{String(r.to).replace('.', ',')} mm</strong>
              <span>{Object.entries(r.settings).map(([k, v]) => `${k} = ${v}`).join(', ') || 'keine Änderungen'}</span>
            </div>
          ))}
        </section>
      )}

      {selectedObj && selectedObj.parts.some((p) => Object.keys(p.settings).length) && (
        <section className="sgroup">
          <h3>Einstellungen einzelner Teile</h3>
          {selectedObj.parts.filter((p) => Object.keys(p.settings).length).map((p, i) => (
            <div key={i} className="range">
              <strong>{p.name} ({KIND_LABEL[p.kind]})</strong>
              <span>{Object.entries(p.settings).map(([k, v]) => `${k} = ${v}`).join(', ')}</span>
            </div>
          ))}
        </section>
      )}

      {hasAny && (
        <details className="allsettings">
          <summary>Alle {allKeys.length} Rohwerte</summary>
          <div className="allsettings-tools">
            <input type="search" placeholder="Schlüssel oder Wert suchen" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Einstellungen durchsuchen" />
            <button className="btn btn-small" onClick={() => download(JSON.stringify(eff, null, 2), `${safeName(project.fileName)}_einstellungen.json`, 'application/json')}>Als JSON speichern</button>
          </div>
          <table className="raw">
            <tbody>
              {filtered.map((k) => (
                <tr key={k} className={overrides.has(k) ? 'is-override' : KNOWN_KEYS.has(k) ? 'is-known' : ''}>
                  <th>{k}</th>
                  <td>{Array.isArray(eff[k]) ? (eff[k] as string[]).join(' | ') : (eff[k] as string)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

/* ---------------- Filament ---------------- */

const GCODE_LABEL: Record<string, string> = { color: 'Farbwechsel', pause: 'Pause', custom: 'Eigener G-Code', template: 'G-Code-Vorlage', tool: 'Filamentwechsel' };

export function FilamentPanel({ project, fils, onSelect }: { project: Project; fils: Filament[]; onSelect: (uid: string) => void }) {
  const sliced = project.plates.filter((p) => p.slice && (p.slice.prediction || p.slice.weight));
  return (
    <div className="fils">
      {fils.map((f) => {
        const users = project.objects.filter((o) => o.extruder === f.index || o.parts.some((p) => p.extruder === f.index));
        return (
          <article key={f.index} className="fil">
            <div className="fil-spool" style={{ ['--c' as string]: f.color }} aria-hidden>
              <span>{f.index}</span>
            </div>
            <div className="fil-body">
              <h3>{f.name}</h3>
              <p className="fil-sub">{[f.type, f.vendor, f.color.toUpperCase()].filter(Boolean).join(', ')}</p>
              <dl className="kv">
                {f.rows.map((r) => (<FragmentRow key={r.label} label={r.label} value={r.value} />))}
              </dl>
              {users.length > 0 && (
                <p className="fil-users">
                  Genutzt von{' '}
                  {users.slice(0, 8).map((o, i) => (
                    <span key={o.uid}>{i ? ', ' : ''}<button className="link" onClick={() => onSelect(o.uid)}>{o.name}</button></span>
                  ))}
                  {users.length > 8 && ` und ${users.length - 8} weiteren`}
                </p>
              )}
            </div>
          </article>
        );
      })}
      {project.customGcodes.length > 0 && (
        <section className="sgroup">
          <h3>Farbwechsel und Pausen</h3>
          <ol className="events">
            {project.customGcodes.map((c, i) => (
              <li key={i}>
                <span className="ev-z">{mm(c.z)}</span>
                {c.kind === 'color' && c.color && <span className="ev-sw" style={{ background: c.color }} aria-hidden />}
                <span className="ev-what">
                  {GCODE_LABEL[c.kind]}
                  {c.kind === 'color' && c.color ? ` zu ${c.color.toUpperCase()}` : ''}
                  {c.kind === 'tool' && c.extruder ? ` zu Filament ${c.extruder}` : ''}
                  {c.extra ? `: ${c.extra}` : ''}
                  {c.plate && project.plates.length > 1 ? `, Platte ${c.plate}` : ''}
                </span>
                {c.gcode && c.kind === 'custom' && <code className="ev-code">{c.gcode}</code>}
              </li>
            ))}
          </ol>
        </section>
      )}
      {sliced.length > 0 && (
        <section className="sgroup">
          <h3>Ergebnis des letzten Slicens</h3>
          <table className="raw">
            <tbody>
              {sliced.map((p) => (
                <tr key={p.index}>
                  <th>{p.name}</th>
                  <td>{[p.slice!.prediction && fmtTime(p.slice!.prediction), p.slice!.weight && `${p.slice!.weight.toFixed(1).replace('.', ',')} g`].filter(Boolean).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (<><dt>{label}</dt><dd>{value}</dd></>);
}

/* ---------------- Info ---------------- */

function htmlDescription(raw: string): string {
  // Bambu/Orca store HTML escaped twice
  let s = raw;
  for (let i = 0; i < 2 && /&lt;|&amp;/.test(s); i++) {
    const t = document.createElement('textarea');
    t.innerHTML = s;
    s = t.value;
  }
  if (!/<[a-z][\s\S]*>/i.test(s)) {
    return s.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('');
  }
  return DOMPurify.sanitize(s, { FORBID_TAGS: ['style', 'form', 'input'], FORBID_ATTR: ['style'] });
}

const META_LABELS: [string, string][] = [
  ['Title', 'Titel'], ['Designer', 'Designer'], ['ProfileUserName', 'Profil von'], ['ProfileTitle', 'Profilname'],
  ['License', 'Lizenz'], ['LicenseTerms', 'Lizenzbedingungen'], ['Copyright', 'Copyright'], ['CreationDate', 'Erstellt'],
  ['ModificationDate', 'Geändert'], ['Origin', 'Herkunft'], ['Application', 'Gespeichert mit'],
];

export function InfoPanel({ project, imageUrls }: { project: Project; imageUrls: Map<string, string> }) {
  const m = project.metadata;
  const desc = m.Description && m.Description !== m.Title ? htmlDescription(m.Description) : '';
  const profDesc = m.ProfileDescription ? htmlDescription(m.ProfileDescription) : '';
  const docs = project.entries.filter((e) => /\.(md|txt|markdown|html?)$/i.test(e.path) || /readme|license|lizenz/i.test(e.path.split('/').pop() ?? ''));
  const pictures = project.entries.filter((e) => imageUrls.has(e.path) && !/\/(pick|top|plate_no_light)_\d+\.png$/i.test(e.path));
  const [zoom, setZoom] = useState<string | null>(null);

  return (
    <div className="info">
      <dl className="kv kv-wide">
        {META_LABELS.filter(([k]) => m[k] && m[k] !== '[]').map(([k, label]) => (
          <FragmentRow key={k} label={label} value={m[k]} />
        ))}
      </dl>
      {desc && (<section className="sgroup"><h3>Beschreibung</h3><div className="prose" dangerouslySetInnerHTML={{ __html: desc }} /></section>)}
      {profDesc && (<section className="sgroup"><h3>Hinweise zum Druckprofil</h3><div className="prose" dangerouslySetInnerHTML={{ __html: profDesc }} /></section>)}
      {docs.map((d) => <DocFile key={d.path} entry={d} />)}
      {pictures.length > 0 && (
        <section className="sgroup">
          <h3>Bilder in der Datei</h3>
          <div className="gallery">
            {pictures.map((e) => (
              <button key={e.path} className="thumb" onClick={() => setZoom(e.path)} title={e.path}>
                <img src={imageUrls.get(e.path)} alt={e.path.split('/').pop()} loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}
      {!desc && !profDesc && !docs.length && !pictures.length && (
        <p className="empty-note">Diese Datei enthält keine Beschreibung, keine Readme und keine Bilder.</p>
      )}
      {zoom && (
        <div className="lightbox" role="dialog" aria-label={zoom} onClick={() => setZoom(null)}>
          <img src={imageUrls.get(zoom)} alt={zoom} />
          <span>{zoom}. Klicken zum Schließen.</span>
        </div>
      )}
    </div>
  );
}

function DocFile({ entry }: { entry: ArchiveEntry }) {
  const text = useMemo(() => new TextDecoder().decode(entry.data.subarray(0, 200_000)), [entry]);
  return (
    <section className="sgroup">
      <h3>{entry.path.split('/').pop()}</h3>
      <pre className="doc">{text}</pre>
    </section>
  );
}

/* ---------------- Dateien ---------------- */

const TEXTY = /\.(xml|config|json|rels|model|txt|md|ini|cfg|gcode|html?)$|\[Content_Types\]/i;

export function FilesPanel({ project, imageUrls }: { project: Project; imageUrls: Map<string, string> }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...project.entries].sort((a, b) => a.path.localeCompare(b.path));
  const preview = open ? project.entries.find((e) => e.path === open) : null;
  return (
    <div className="files">
      <p className="files-note">Eine 3MF-Datei ist ein ZIP-Archiv. Hier siehst du alles, was drinsteckt, und kannst jede Datei einzeln speichern.</p>
      <ul className="filelist">
        {sorted.map((e) => (
          <li key={e.path} className={open === e.path ? 'is-open' : ''}>
            <button className="file-name" onClick={() => setOpen(open === e.path ? null : e.path)} disabled={!TEXTY.test(e.path) && !imageUrls.has(e.path)}>
              {e.path}
            </button>
            <span className="file-size">{fmtBytes(e.size)}</span>
            <button className="btn btn-small" onClick={() => download(e.data, e.path.split('/').pop() ?? 'datei')}>Speichern</button>
          </li>
        ))}
      </ul>
      {preview && (
        <div className="preview">
          {imageUrls.has(preview.path) ? (
            <img src={imageUrls.get(preview.path)} alt={preview.path} />
          ) : (
            <pre className="doc">{preview.size > 400_000
              ? `${new TextDecoder().decode(preview.data.subarray(0, 400_000))}\n\n… gekürzt, die Datei ist ${fmtBytes(preview.size)} groß. Mit „Speichern“ bekommst du sie vollständig.`
              : entryText(project.entries, preview.path)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Hinweise ---------------- */

export function HintsPanel({ hints, project }: { hints: Hint[]; project: Project }) {
  return (
    <div className="hints">
      <p className="hints-lead">
        Gespeichert mit <strong>{project.slicer.name}{project.slicer.version ? ` ${project.slicer.version}` : ''}</strong>
        {first(project.settings.printer_model) || first(project.settings.printer_settings_id) ? <> für <strong>{first(project.settings.printer_model) || first(project.settings.printer_settings_id)}</strong></> : null}.
        Das kann beim Öffnen in einem anderen Slicer schiefgehen:
      </p>
      {hints.length === 0 && <p className="empty-note">Nichts Auffälliges. Die Datei sollte sich überall öffnen lassen.</p>}
      {hints.map((h, i) => (
        <article key={i} className={`hint hint-${h.level}`}>
          <h3>{h.title}</h3>
          <p>{h.body}</p>
        </article>
      ))}
    </div>
  );
}

export { filaments };
