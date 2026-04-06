# SkinApex

Browser-based Minecraft Bedrock skin pack editor with live 3D preview, bone tools, animation mapping, and pack utilities.

SkinApex is built for editing Bedrock skin packs directly in the browser. Open an existing pack, inspect files, preview models in 3D, adjust bones, edit skin metadata, and work with animation mappings without needing a backend service.

## Highlights

- Open `.mcpack`, `.zip`, files, or full folders
- Live 3D Bedrock skin preview
- Bone outline and transform editing
- Skin property editing
- Animation mapping editor for `slot > animation_id`
- Official Bedrock animation autocomplete
- Lazy-loaded animation data for better runtime behavior
- Pack encrypt / decrypt tooling
- Desktop and mobile layouts
- English and Simplified Chinese UI

## Quick Start

This project is static frontend code. You can run it with any local HTTP server.

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

## What You Can Do

### Open and inspect packs

- Load `.mcpack` and `.zip` archives
- Open folders directly
- Browse the pack file tree
- Parse `manifest.json`, `skins.json`, textures, and geometry files

### Preview and edit skins

- View skins in a live 3D preview
- Inspect geometry and animated bones
- Edit bone transforms
- Edit skin properties and animation mappings

### Work with animations

- Autocomplete official Bedrock animation IDs
- Use generated slot suggestions for the left side of animation mappings
- Load animation JSON lazily only when the current skin needs it
- Inspect affected bones for a selected animation

### Pack utilities

- Save edited packs
- Use pack encrypt / decrypt tools
- Work across desktop and mobile layouts

## Official Animation Assets

SkinApex keeps official Bedrock animation JSON files in:

- `vendor/official-animations/`

The app uses two generated index files:

- `index.json`
  - maps `filename -> [animationId, ...]`
  - used for animation autocomplete and lazy lookup
- `slot-index.json`
  - generated slot suggestion list for the left side of animation mappings

Animation files are not eagerly loaded.
The app first reads the lightweight index files, then fetches actual animation JSON only for the animation IDs needed by the current skin.

## Rebuild Animation Indexes

If you update files inside `vendor/official-animations/`, rebuild the generated indexes with:

```bash
node scripts/build-official-animation-index.js
```

## Project Structure

- `index.html` - app shell
- `css/style.css` - layout, components, and responsive styling
- `js/` - application logic
- `scripts/build-official-animation-index.js` - rebuilds animation indexes
- `vendor/official-animations/` - official animation JSON assets and generated indexes

## GitHub Pages Deployment

Because SkinApex is a static app, it can be deployed directly to GitHub Pages.

### Typical setup

1. Push the repository to GitHub
2. Open repository `Settings`
3. Go to `Pages`
4. Select your deployment branch, usually `main`
5. Publish from the repository root

If you deploy under a project subpath, verify that static asset paths still resolve correctly.

## Notes

- Mobile input zoom is handled by increasing mobile form control font sizes to prevent browser auto-zoom on focus.
- The 3D preview uses a smaller near clipping plane to reduce visible interior clipping when zooming in closely.
- Do not reintroduce the full `vendor/bedrock-samples` repository just to source animations. This project only needs the extracted animation JSON files.

## License

Recommended: `MIT` if you want the project to be easy to reuse, fork, and contribute to.

If you want to require derivative projects to stay open source, use `GPL-3.0` instead.

For this project, `MIT` is probably the best default unless you specifically want copyleft.
