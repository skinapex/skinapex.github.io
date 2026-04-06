#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const animationsDir = path.join(rootDir, 'vendor', 'official-animations');
const indexPath = path.join(animationsDir, 'index.json');
const slotIndexPath = path.join(animationsDir, 'slot-index.json');

function stripJsonCommentsAndTrailingCommas(raw) {
    return raw
        .replace(/\/\/.*$/gm, '')
        .replace(/,\s*([\]}])/g, '$1');
}

function toSlotName(animationId) {
    if (typeof animationId !== 'string' || !animationId.startsWith('animation.')) return null;
    const parts = animationId.split('.');
    if (parts.length < 3) return null;

    const slot = parts.slice(2).join('.');
    if (!slot) return null;

    // Filter obviously noisy/generated prefixes like animation.0.walk
    if (/^\d/.test(slot)) return null;
    return slot;
}

function main() {
    if (!fs.existsSync(animationsDir)) {
        console.error('Missing directory:', animationsDir);
        process.exit(1);
    }

    const files = fs.readdirSync(animationsDir)
        .filter((file) => file !== 'index.json' && file.endsWith('.json'))
        .sort();

    const index = {};
    const slotSet = new Set();
    let totalAnimationIds = 0;

    files.forEach((file) => {
        const filePath = path.join(animationsDir, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            const cleaned = stripJsonCommentsAndTrailingCommas(raw);
            const json = JSON.parse(cleaned);
            const ids = json && json.animations ? Object.keys(json.animations).sort() : [];
            if (ids.length) {
                index[file] = ids;
                totalAnimationIds += ids.length;
                ids.forEach((id) => {
                    const slot = toSlotName(id);
                    if (slot) slotSet.add(slot);
                });
            }
        } catch (err) {
            console.warn('Skipping invalid animation file:', file, '-', err.message);
        }
    });

    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
    fs.writeFileSync(slotIndexPath, JSON.stringify(Array.from(slotSet).sort(), null, 2) + '\n');
    console.log('Wrote', indexPath);
    console.log('Wrote', slotIndexPath);
    console.log('Files:', Object.keys(index).length);
    console.log('Animation IDs:', totalAnimationIds);
    console.log('Slot suggestions:', slotSet.size);
}

main();
