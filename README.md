# SkinApex

SkinApex is a browser-based editor for Minecraft Bedrock skin packs. It is built around practical Bedrock workflows: opening real pack files, inspecting textures and geometry, editing bones, checking UV layout, managing animation mappings, and validating common human-rig issues before export.

## What SkinApex Does

- Open Bedrock skin pack content from `.mcpack`, `.zip`, loose files, or full folders
- Browse pack contents directly in the workspace
- Preview skins in both 3D and UV modes
- Edit bones, pivots, transforms, and hierarchy
- Edit skin metadata and animation mappings
- Preview bound animations and built-in preview actions
- Inspect affected bones for official animation references
- Validate common Bedrock human-style rig naming and hierarchy issues
- Save changes back into the current project
- Encrypt or decrypt supported packs

## Preview Workflow

The preview area is split into two modes:

- `3D`
  - Inspect the model from different angles
  - Select bones directly from the preview when supported
  - Use transform gizmos to move, rotate, or edit pivots
  - Open the `3D Options` overlay to control:
    - `Bound Animation`
    - `Preview Action`
    - `Mesh Normals`
    - `Look At Pointer`
- `UV`
  - Inspect texture layout and box UV placement
  - Check per-face alignment issues
  - Focus on texture-to-geometry relationships without the 3D-only controls

`Bound Animation` and `Preview Action` are intentionally separate concepts in the UI:

- `Bound Animation` reflects animation mappings attached to the selected skin
- `Preview Action` drives built-in movement-style preview states such as walking or sneaking

Under the hood, both are still animation-driven, but separating them in the UI makes the workflow easier to reason about.

## Bone Editing

SkinApex includes a Bedrock-oriented bone editing workflow:

- Select bones from the outline or directly in 3D preview
- Edit:
  - name
  - parent
  - pivot / origin
  - rotation
  - translation / offset where supported by the current workflow
- Add bones or groups
- Delete a single bone or a full subtree
- Reorder or reparent bones from the outline

The right-side panel is context-sensitive and switches between skin properties, outline information, and bone properties based on the active selection.

## Animation Mapping Support

SkinApex supports editing Bedrock skin animation mappings in the usual `slot -> animation_id` form.

Features include:

- official animation ID autocomplete
- generated slot suggestions
- affected-bone lookup for known official animations
- lazy loading of official animation JSON data

Official animation data is not loaded eagerly. The app reads lightweight index files first, then loads only the animation files needed by the current skin and preview state.

## Built-In Preview Actions

The 3D preview can simulate common player-style states through `Preview Action` presets, including:

- walk
- run
- walk/run transition
- sneak
- sneak move

These actions are implemented through animation combinations and preview state values rather than hard-coded bone poses, so they stay closer to Bedrock animation behavior.

## Rig Validation

SkinApex includes checks aimed at common Bedrock human-style rigs.

It helps detect issues such as:

- missing important bones
- incorrect parent-child hierarchy
- misleading or non-canonical bone names
- duplicate naming that may still render but causes workflow confusion

This validation is practical rather than universal. It is designed for common Bedrock-style human rigs, not every possible custom creature setup.

## Official Animation Assets

Official animation JSON files live in:

- `vendor/official-animations/`

The app uses generated index files there:

- `index.json`
  - maps `filename -> [animationId, ...]`
  - used for autocomplete and lazy lookup
- `slot-index.json`
  - generated slot suggestion list for animation mappings

If you add, remove, or update official animation files, rebuild the indexes with:

```bash
node scripts/build-official-animation-index.js
```

## Running Locally

This project is static frontend code. Any simple local HTTP server is enough.

### Python

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

### Node.js

```bash
npx serve .
```

## Project Structure

- `index.html`
  - app shell, welcome page, workspace layout
- `css/style.css`
  - editor layout, responsive styles, preview UI, panel styling
- `js/`
  - main application logic
- `js/model-viewer.js`
  - 3D preview, animation execution, pointer-follow behavior, transform controls
- `js/preview-panel.js`
  - preview mode switching, 3D options UI, UV/3D integration
- `js/outline.js`
  - bone outline, validation badges, drag/reparent interactions
- `js/bone-editor.js`
  - bone property editing UI
- `js/history.js`
  - per-tab undo/redo history handling
- `scripts/build-official-animation-index.js`
  - rebuilds official animation indexes
- `vendor/official-animations/`
  - official animation JSON assets and generated indexes

## Mobile Notes

- The app supports desktop and mobile layouts
- On smaller screens, Explorer, Preview, and Sidebar are split into separate navigation targets
- 3D options are kept inside the preview overlay to reduce wasted vertical space
- Mobile form controls use larger font sizes to avoid browser auto-zoom on focus

## Notes

- Some tools are optimized for common human-style Bedrock rigs and may not fully apply to every custom model
- The preview system aims to stay close to Bedrock behavior, but it is still an editor preview rather than the game runtime
- Official animation data should remain lazy-loaded; do not switch back to eager loading
- This project uses extracted official animation JSON files and does not need the full `vendor/bedrock-samples` repository

## Deployment

Because SkinApex is a static app, it can be hosted directly on GitHub Pages or any static file host.

Typical GitHub Pages flow:

1. Push the repository to GitHub
2. Open repository `Settings`
3. Go to `Pages`
4. Choose the deployment branch, usually `main`
5. Publish from the repository root

If you deploy under a subpath, verify that static asset URLs still resolve correctly.
