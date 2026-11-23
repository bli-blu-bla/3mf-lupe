# 3MF Lupe

3MF-Dateien aus Bambu Studio, OrcaSlicer, PrusaSlicer und Cura im Browser öffnen: Objekte als STL exportieren, Infill, Filament und Druckeinstellungen auslesen. Alles läuft lokal, die Datei wird nirgends hochgeladen.

## Was ausgelesen wird

| Quelle | Inhalt |
|---|---|
| `3D/*.model` (auch Unterdateien der Production Extension) | Geometrie, Bauplan, Transformationen, aufgemalte Stützen, Naht und Farben |
| `Metadata/project_settings.config` (Bambu, Orca, Creality, Anycubic) | alle Druck-, Filament- und Druckereinstellungen, „vom Systemprofil abweichend“ |
| `Metadata/model_settings.config` | Platten, Objekt- und Teilenamen, Modifier, Einstellungen pro Objekt und Teil |
| `Metadata/Slic3r_PE.config` / `Slic3r_PE_model.config` (PrusaSlicer) | Einstellungen, Volumes, Modifier, Höhenbereiche |
| `Metadata/Prusa_Slicer_custom_gcode_per_print_z.xml`, `custom_gcode_per_layer.xml` | Farbwechsel, Pausen und eigener G-Code pro Höhe |
| `Metadata/Prusa_Slicer_layers.txt`, `layer_heights_profile.txt` | variable Schichthöhe pro Objekt |
| `Metadata/Prusa_Slicer_layer_config_ranges.xml`, `layer_config_ranges.xml` | Höhenbereiche mit eigenen Einstellungen |
| Dreiecks-Attribute `slic3rpe:custom_supports`, `mmu_segmentation`, `paint_*` | aufgemalte Stützen und Farben, dekodiert und im Viewer eingefärbt (`src/lib/paint.ts`) |
| `Cura/*.cfg` | Werte der Cura-Profile (best effort) |
| `Metadata/slice_info.config` | Druckzeit und Gewicht, falls die Datei geslict wurde |
| `Auxiliaries/`, Thumbnails, `.md`/`.txt` | Beschreibung, Bilder, Readmes |

## Entwicklung

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # Ausgabe in dist/
```

## Deployment auf GitHub Pages

1. Repository auf GitHub anlegen und `main` pushen.
2. Unter *Settings → Pages → Build and deployment* als Quelle **GitHub Actions** wählen.
3. Jeder Push auf `main` baut die Seite und veröffentlicht sie (`.github/workflows/deploy.yml`).

`vite.config.ts` nutzt `base: './'`, daher funktioniert die Seite unter jedem Repository-Pfad.

## Aufbau

- `src/lib/parse.worker.ts`: entpackt und parst die Modelle in einem Web Worker (auch 20-MB-Modelle in rund 1,5 s)
- `src/lib/project.ts`: Slicer-Erkennung, Config-Parser, Objekte und Platten
- `src/lib/settings.ts`: einheitliche Zuordnung der Einstellungs-Schlüssel aller Slicer
- `src/lib/export.ts`: binärer STL-Export, ZIP über fflate
- `src/lib/hints.ts`: Kompatibilitätshinweise
- `src/components/CrossSection.tsx`: maßstäbliches Schnittbild aus Wänden, Infill-Muster und Schichten
