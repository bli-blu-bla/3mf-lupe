import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Viewer, { SUPPORT_PAINT, type PaintMode } from './components/Viewer';
import { FilamentPanel, FilesPanel, HintsPanel, InfoPanel, ObjectsPanel, PrintPanel, fmtBytes } from './components/Panels';
import { exportMergedStl, exportZip, exportableParts } from './lib/export';
import { buildHints } from './lib/hints';
import { loadFile, mulMat } from './lib/project';
import { filaments } from './lib/settings';
import type { Project } from './lib/types';

type Tab = 'objects' | 'print' | 'filament' | 'info' | 'files' | 'hints';

const IMG = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml' };

function useDark() {
  const [dark, setDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => setDark(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plate, setPlate] = useState<number | 'all'>(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('objects');
  const [dragging, setDragging] = useState(false);
  const [includeHelpers, setIncludeHelpers] = useState(false);
  const [showHelpers, setShowHelpers] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paintMode, setPaintMode] = useState<PaintMode>('none');
  const inputRef = useRef<HTMLInputElement>(null);
  const dark = useDark();

  const open = useCallback(async (file: File) => {
    if (!/\.3mf$/i.test(file.name)) {
      setError(`„${file.name}“ ist keine .3mf-Datei. Ziehe eine Datei mit der Endung .3mf hierher.`);
      return;
    }
    setError(null);
    setBusy(`${file.name} wird gelesen (${fmtBytes(file.size)})`);
    try {
      const p = await loadFile(file);
      setProject(p);
      setPlate(p.plates[0]?.index ?? 1);
      const meshes = Array.from(p.meshes.values());
      setPaintMode(meshes.some((m) => m.paintColors) ? 'colors' : meshes.some((m) => m.paintSupports) ? 'supports' : 'none');
      setSelected(null);
      setTab('objects');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  // drag & drop anywhere
  useEffect(() => {
    let depth = 0;
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); } };
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (e: DragEvent) => {
      e.preventDefault(); depth = 0; setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) open(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [open]);

  const fils = useMemo(() => (project ? filaments(project.settings) : []), [project]);
  const colors = useMemo(() => fils.map((f) => f.color), [fils]);
  const hints = useMemo(() => (project ? buildHints(project) : []), [project]);

  const imageUrls = useMemo(() => {
    const m = new Map<string, string>();
    if (!project) return m;
    for (const e of project.entries) {
      const ext = e.path.split('.').pop()?.toLowerCase() ?? '';
      if (IMG.test(e.path)) m.set(e.path, URL.createObjectURL(new Blob([e.data as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' })));
    }
    return m;
  }, [project]);
  useEffect(() => () => { for (const u of imageUrls.values()) URL.revokeObjectURL(u); }, [imageUrls]);

  // object dimensions (after placement transform)
  const dims = useMemo(() => {
    const out = new Map<string, number[]>();
    if (!project) return out;
    for (const o of project.objects) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const part of exportableParts(o)) {
        const mesh = project.meshes.get(part.meshKey);
        if (!mesh) continue;
        const m = mulMat(part.matrix, o.transform);
        // only vertices referenced by this part's triangles
        const I = mesh.indices, P = mesh.positions;
        const step = part.triEnd - part.triStart > 60000 ? 3 : 1;
        for (let t = part.triStart * 3; t < part.triEnd * 3; t += step) {
          const i = I[t] * 3, x = P[i], y = P[i + 1], z = P[i + 2];
          const v = [x * m[0] + y * m[3] + z * m[6] + m[9], x * m[1] + y * m[4] + z * m[7] + m[10], x * m[2] + y * m[5] + z * m[8] + m[11]];
          for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; }
        }
      }
      if (Number.isFinite(min[0])) out.set(o.uid, max.map((v, k) => v - min[k]));
    }
    return out;
  }, [project]);

  const plateObjects = useMemo(() => {
    if (!project) return [];
    if (plate === 'all' || project.plates.length <= 1) return project.objects;
    return project.objects.filter((o) => o.plate === plate);
  }, [project, plate]);

  const paintAvail = useMemo(() => {
    const meshes = project ? Array.from(project.meshes.values()) : [];
    return { supports: meshes.some((m) => m.paintSupports), colors: meshes.some((m) => m.paintColors) };
  }, [project]);

  const selectedObj = project?.objects.find((o) => o.uid === selected) ?? null;
  const currentPlate = project && plate !== 'all' ? project.plates.find((p) => p.index === plate) : null;

  const select = (uid: string | null) => {
    setSelected(uid);
    if (uid && project && plate !== 'all') {
      const o = project.objects.find((x) => x.uid === uid);
      if (o?.plate && o.plate !== plate) setPlate(o.plate);
    }
  };

  // close export menu on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !(e.target as Element).closest('.export')) setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close); };
  }, [menuOpen]);

  const baseName = project?.fileName.replace(/\.3mf$/i, '') ?? '';
  const plateLabel = currentPlate && project!.plates.length > 1 ? `${baseName} ${currentPlate.name}` : baseName;

  return (
    <div className={`app${project ? ' has-project' : ''}`}>
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden><rect x="2" y="2" width="28" height="28" rx="6" className="brand-plate" /><g className="brand-lines"><rect x="8" y="8" width="16" height="16" rx="2" /><path d="M8 14 L14 8 M8 20 L20 8 M8 24 L24 8 M12 24 L24 12 M18 24 L24 18" /></g></svg>
          <span>3MF Lupe</span>
        </div>
        {project && (
          <>
            <div className="filechip" title={project.fileName}>
              <span className="filechip-name">{project.fileName}</span>
              <span className="filechip-slicer">{project.slicer.name}{project.slicer.version ? ` ${project.slicer.version}` : ''}</span>
            </div>
            <div className="topbar-actions">
              <div className="export">
                <button className="btn btn-primary" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>STL exportieren</button>
                {menuOpen && (
                  <div className="menu" role="menu">
                    {currentPlate && project.plates.length > 1 && (
                      <>
                        <p className="menu-head">{currentPlate.name}</p>
                        <button role="menuitem" onClick={() => { exportZip(project, plateObjects, plateLabel, { includeHelpers }); setMenuOpen(false); }}>
                          Jedes Objekt einzeln <small>ZIP mit {plateObjects.length} STL-Dateien</small>
                        </button>
                        <button role="menuitem" onClick={() => { exportMergedStl(project, plateObjects, plateLabel, { includeHelpers }); setMenuOpen(false); }}>
                          Ganze Platte als eine STL <small>Anordnung bleibt erhalten</small>
                        </button>
                        <p className="menu-head">Ganzes Projekt</p>
                      </>
                    )}
                    <button role="menuitem" onClick={() => { exportZip(project, project.objects, baseName, { includeHelpers }); setMenuOpen(false); }}>
                      Alle Objekte einzeln <small>ZIP mit {project.objects.length} STL-Dateien{project.plates.length > 1 ? ', Ordner pro Platte' : ''}</small>
                    </button>
                    {project.plates.length <= 1 && (
                      <button role="menuitem" onClick={() => { exportMergedStl(project, project.objects, baseName, { includeHelpers }); setMenuOpen(false); }}>
                        Alles als eine STL <small>Anordnung bleibt erhalten</small>
                      </button>
                    )}
                    <label className="menu-check">
                      <input type="checkbox" checked={includeHelpers} onChange={(e) => setIncludeHelpers(e.target.checked)} />
                      Modifier und Hilfskörper mitexportieren
                    </label>
                  </div>
                )}
              </div>
              <button className="btn" onClick={() => inputRef.current?.click()}>Andere Datei</button>
            </div>
          </>
        )}
        <input ref={inputRef} type="file" accept=".3mf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ''; }} />
      </header>

      {!project && (
        <main className="landing">
          <div className="landing-plate">
            <div className="landing-copy">
              <h1>Fremde 3MF-Datei? Schau rein, bevor dein Slicer sie verbiegt.</h1>
              <p>
                Projekte aus Bambu Studio, OrcaSlicer, PrusaSlicer oder Cura öffnen sich im jeweils anderen Slicer oft falsch.
                Dann fehlen Platten, Infill, Stützen oder Filament-Werte. Hier liest du alles aus und holst die Objekte als STL heraus.
              </p>
              <button className="btn btn-primary btn-big" onClick={() => inputRef.current?.click()}>3MF-Datei öffnen</button>
              <p className="landing-small">oder irgendwo hier ablegen. Die Datei bleibt auf deinem Rechner. Nichts wird hochgeladen.</p>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
            <ul className="landing-list">
              <li><strong>Objekte als STL</strong> einzeln, pro Platte oder alle als ZIP</li>
              <li><strong>Infill, Wände, Stützen</strong> als Werte und als Schnittbild</li>
              <li><strong>Filamente</strong> mit Farbe, Temperaturen und Fluss</li>
              <li><strong>Einstellungen pro Objekt</strong> gehen beim Import oft verloren, hier siehst du sie</li>
              <li><strong>Beschreibung, Bilder und Dateien</strong> aus dem Archiv</li>
            </ul>
          </div>
        </main>
      )}

      {project && (
        <main className="workspace">
          <section className="stage" aria-label="Druckplatte">
            {project.plates.length > 1 && (
              <nav className="plates" aria-label="Druckplatten">
                {project.plates.map((p) => (
                  <button key={p.index} className={`plate-tab${plate === p.index ? ' is-active' : ''}`} onClick={() => { setPlate(p.index); setSelected(null); }} title={p.name}>
                    <span className="plate-no">{p.index}</span>
                    <span className="plate-name">{p.name}</span>
                    <span className="plate-count">{p.objectUids.length}</span>
                  </button>
                ))}
                <button className={`plate-tab${plate === 'all' ? ' is-active' : ''}`} onClick={() => setPlate('all')}>
                  <span className="plate-name">Alle Platten</span>
                </button>
              </nav>
            )}
            <div className="viewer">
              <Viewer project={project} plate={project.plates.length > 1 ? plate : 'all'} selected={selected} onSelect={select} colors={colors} showHelpers={showHelpers} paintMode={paintMode} dark={dark} />
              <div className="viewer-hud">
                <span>{plateObjects.length} {plateObjects.length === 1 ? 'Objekt' : 'Objekte'}</span>
                {project.bed.width > 0 && <span>Bett {project.bed.width} × {project.bed.depth} mm</span>}
                {project.objects.some((o) => o.parts.some((p) => p.kind !== 'model')) && (
                  <label><input type="checkbox" checked={showHelpers} onChange={(e) => setShowHelpers(e.target.checked)} /> Hilfskörper zeigen</label>
                )}
              </div>
              {(paintAvail.supports || paintAvail.colors) && (
                <div className="paintbar" role="radiogroup" aria-label="Aufgemalte Bereiche anzeigen">
                  <span className="paintbar-label">Bemalung</span>
                  {([['none', 'Aus'], ...(paintAvail.supports ? [['supports', 'Stützen']] : []), ...(paintAvail.colors ? [['colors', 'Farben']] : [])] as [PaintMode, string][]).map(([id, label]) => (
                    <button key={id} role="radio" aria-checked={paintMode === id} className={paintMode === id ? 'is-active' : ''} onClick={() => setPaintMode(id)}>{label}</button>
                  ))}
                  {paintMode === 'supports' && (
                    <span className="paint-legend">
                      <i style={{ background: SUPPORT_PAINT.enforcer }} />Stütze erzwingen
                      <i style={{ background: SUPPORT_PAINT.blocker }} />Stütze verhindern
                    </span>
                  )}
                </div>
              )}
              <p className="viewer-help">Ziehen zum Drehen, rechte Maustaste zum Verschieben, Mausrad zum Zoomen, Klick wählt ein Objekt.</p>
            </div>
          </section>

          <aside className="inspector">
            <nav className="tabs" role="tablist">
              {([
                ['objects', 'Objekte', plateObjects.length],
                ['print', 'Druck', null],
                ['filament', 'Filament', fils.length],
                ['info', 'Info', null],
                ['files', 'Dateien', project.entries.length],
                ['hints', 'Hinweise', hints.filter((h) => h.level === 'warn').length || null],
              ] as [Tab, string, number | null][]).map(([id, label, n]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? ' is-active' : ''}${id === 'hints' && n ? ' has-warn' : ''}`} onClick={() => setTab(id)}>
                  {label}{n ? <span className="tab-n">{n}</span> : null}
                </button>
              ))}
            </nav>
            <div className="panel" role="tabpanel">
              {tab === 'objects' && <ObjectsPanel project={project} objects={plateObjects} selected={selected} onSelect={select} colors={colors} dims={dims} includeHelpers={includeHelpers} />}
              {tab === 'print' && <PrintPanel project={project} selectedObj={selectedObj} onClear={() => setSelected(null)} color={colors[(selectedObj?.extruder ?? 1) - 1] ?? colors[0] ?? '#9aa19d'} />}
              {tab === 'filament' && <FilamentPanel project={project} fils={fils} onSelect={(uid) => { select(uid); setTab('objects'); }} />}
              {tab === 'info' && <InfoPanel project={project} imageUrls={imageUrls} />}
              {tab === 'files' && <FilesPanel project={project} imageUrls={imageUrls} />}
              {tab === 'hints' && <HintsPanel hints={hints} project={project} />}
            </div>
          </aside>
          {error && <p className="error error-float" role="alert" onClick={() => setError(null)}>{error}</p>}
        </main>
      )}

      {(dragging || busy) && (
        <div className="overlay" aria-live="polite">
          <div className="overlay-card">
            {busy ? <><span className="spinner" aria-hidden />{busy}</> : 'Loslassen zum Öffnen'}
          </div>
        </div>
      )}
    </div>
  );
}
