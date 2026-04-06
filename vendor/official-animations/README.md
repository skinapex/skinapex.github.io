# Official Animations

This directory stores the Bedrock official animation JSON files used for:

- animation autocomplete
- lazy-loading animation data for skins that reference animations
- viewing affected bones for a selected animation

`index.json` and `slot-index.json` are generated from the JSON files in this directory.

- `index.json`: file-to-animation-id mapping for autocomplete and lazy loading
- `slot-index.json`: generated slot suggestion list for the left side of animation mappings

Rebuild it after adding, removing, or updating animation files:

```bash
node scripts/build-official-animation-index.js
```
