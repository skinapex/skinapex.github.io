# Agent Notes

## Official Animations

This project keeps Bedrock official animation assets in:

- `vendor/official-animations/`

Do not reintroduce the full `vendor/bedrock-samples` repository just to access animations.
Only the animation JSON files are needed here.

## Generated Index Files

The animation directory contains two generated index files:

- `vendor/official-animations/index.json`
  - maps `filename -> [animationId, ...]`
  - used for animation autocomplete and lazy lookup
- `vendor/official-animations/slot-index.json`
  - contains generated left-side slot suggestions
  - used for the `slot > animationId` UI mapping editor

Both files are generated from the JSON animation files in `vendor/official-animations/`.

## Rebuild Command

After adding, removing, or updating official animation JSON files, rebuild both indexes with:

```bash
node scripts/build-official-animation-index.js
```

## Runtime Loading Rules

Animation loading is intentionally split into two stages:

1. Load only index files when needed for suggestions/autocomplete.
2. Load actual animation JSON bodies lazily only for animation IDs the current skin uses.

Do not change this back to eager-loading all official animation files.

## Slot Mapping Semantics

Skin animation mappings follow this pattern:

```json
{
  "animations": {
    "move.arms": "animation.player.move.arms"
  }
}
```

- left side: slot / mapping key
- right side: actual official animation ID

The left-side slot list is not hardcoded anymore.
It is generated from official animation IDs using the build script.

Example:

- `animation.player.move.arms` -> `move.arms`
- `animation.player.cape` -> `cape`
- `animation.player.attack.positions` -> `attack.positions`

## Relevant Code

- `scripts/build-official-animation-index.js`
- `js/project.js`
- `js/app.js`
- `js/model-viewer.js`
- `js/skin-properties.js`

## Maintenance Guidance

- Prefer minimal changes.
- Keep autocomplete index loading lightweight.
- Keep actual animation data loading lazy.
- If updating slot generation rules, regenerate `slot-index.json` and verify the picker suggestions remain useful.
