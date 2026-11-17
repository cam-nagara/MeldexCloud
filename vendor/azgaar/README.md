# Azgaar model Worker

This is Azgaar Fantasy Map Generator **v1.156.0**, revision
`67d555b83f0b2f40ae50b03c9bbfd018175acc6d`, licensed under MIT.
The upstream generation pipeline is bundled without changing its algorithms.
See `LICENSE`, `THIRD_PARTY_NOTICES.txt`, and `provenance.json`.

Meldex runs one disposable Worker per preview. It uses procedural heightmap
templates only. Network fetching is disabled. The bundle uses no real localStorage, upstream UI,
analytics, AI service, or account integration. The icon catalog is retained for
the model; unused SVG artwork is omitted from the bundle. Meldex supplies its own
editing UI and symbols.

To rebuild (Node 24 recommended):

```powershell
git clone --branch v1.156.0 --depth 1 https://github.com/Azgaar/Fantasy-Map-Generator.git <checkout>
cd <checkout>
npm ci --ignore-scripts --no-audit --no-fund
cd <Meldex checkout>
node app/scripts/build_azgaar.mjs --source <checkout>
```

The builder verifies the pinned revision and unchanged generation sources. It
bundles the model entry in `app/scripts/azgaar-worker-entry.js` and records bundled
dependency licenses. No upstream installation scripts are needed.

`.mel-map` remains schema v1. Additive `atlas` data contains numeric dimensions,
colors and validated SVG path data, never arbitrary SVG markup. Standard Meldex
features retain cities, state outlines, lakes, rivers and routes; optional native
paths preserve curves, disconnected areas and river widths. Translating a feature
retains its path. Vertex editing invalidates the path and uses ordinary geometry.
Old readers have a PNG base and ordinary feature geometry. Old worlds are never
regenerated when opened.

New worlds also retain a bounded, base64-encoded numeric mesh in `atlas.surface`.
It contains native cell positions, triangle indices, elevations, temperature,
precipitation and biome IDs. Meldex interpolates these fields and smooths lighting
normals for hillshade; it does not alter the generation model or drainage. Coast,
river and route geometry remains vector data. Decode and image caches are bounded
and shared across identical Undo snapshots. Unknown private mesh metadata is
excluded from portable packages. The vector palette remains a fallback for older
worlds and readers.

This integration is a generator, not the complete Azgaar editor or `.map` file
round-trip. Native heightmap painting, upstream relief art, cultures, religions,
diplomacy, economics and province editors are not exposed by Meldex. Generated
terrain is updated through world generation; the existing low-resolution brush
is disabled for an Azgaar atlas. Existing legacy terrain maps keep their tools.
