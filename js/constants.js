/* ============================================================
   SkinApex - Constants & Configuration
   ============================================================ */

const SkinApex = window.SkinApex || {};

SkinApex.Icons = {
    folder: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 2h4.29l.89 1.5H14a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H1.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z" fill="#c09553"/></svg>',
    folderOpen: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 2h4.29l.89 1.5H14a.5.5 0 01.5.5v9a.5.5 0 01-.5.5H1.5a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5z" fill="#c09553"/><path d="M2 5h12v7.5a.5.5 0 01-.5.5h-11a.5.5 0 01-.5-.5V5z" fill="#e8c88a"/></svg>',
    file: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="none" stroke="#8b8b8b" stroke-width="1"/><path d="M9.5 1v3.5H13" fill="none" stroke="#8b8b8b" stroke-width="1"/></svg>',
    fileJson: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#519aba"/><text x="4" y="12" font-size="8" fill="#fff" font-family="monospace">{ }</text></svg>',
    fileImage: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#a074c4"/><path d="M5 10l2-2 1.5 1.5L11 7l2 3H5z" fill="#e8c4f0"/></svg>',
    fileZip: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 1h6.5L13 4.5V14a1 1 0 01-1 1H4a1 1 0 01-1-1V2a1 1 0 011-1z" fill="#6b8e23"/><text x="5.5" y="11" font-size="6" fill="#fff" font-family="monospace">ZIP</text></svg>',
    chevron: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    skin: '<svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="1" width="10" height="5" rx="1" fill="none" stroke="#8b8b8b" stroke-width="1"/><rect x="4" y="6" width="8" height="9" rx="1" fill="none" stroke="#8b8b8b" stroke-width="1"/></svg>',
    bone: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none"><circle cx="5" cy="2.5" r="2" stroke="#8b8b8b" stroke-width="1.2"/><circle cx="11" cy="13.5" r="2" stroke="#8b8b8b" stroke-width="1.2"/><path d="M5 4.5V7.5l2 1V11l2 2.5" stroke="#8b8b8b" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 11.5V8.5l-2-1V5L7 2.5" stroke="#8b8b8b" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    person: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.4"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.5-7 7-7s7 3 7 7"/></svg>',
    cube: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
};

SkinApex.ACCEPTED_EXTENSIONS = /\.(zip|mcpack)$/i;
SkinApex.IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|bmp|tga)$/i;

/**
 * Built-in Mojang Bedrock geometry definitions.
 * These are used when a skin references a standard geometry (e.g. geometry.humanoid.custom)
 * but the skin pack does not include its own geometry.json file.
 */
SkinApex.BUILTIN_GEOMETRIES = {
    'geometry.humanoid.custom': {
        description: {
            identifier: 'geometry.humanoid.custom',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2,
            visible_bounds_height: 1.8,
            visible_bounds_offset: [0, 1.62, 0]
        },
        bones: [
            {
                name: 'root',
                pivot: [0, 0, 0]
            },
            {
                name: 'waist',
                parent: 'root',
                pivot: [0, 12, 0]
            },
            {
                name: 'body',
                parent: 'waist',
                pivot: [0, 24, 0],
                cubes: [
                    { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] },
                    { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 }
                ]
            },
            {
                name: 'head',
                parent: 'body',
                pivot: [0, 24, 0],
                cubes: [
                    { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
                    { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }
                ]
            },
            {
                name: 'leftArm',
                parent: 'body',
                pivot: [5, 22, 0],
                cubes: [
                    { origin: [4, 12, -2], size: [4, 12, 4], uv: [32, 48] },
                    { origin: [4, 12, -2], size: [4, 12, 4], uv: [48, 48], inflate: 0.25 }
                ]
            },
            {
                name: 'rightArm',
                parent: 'body',
                pivot: [-5, 22, 0],
                cubes: [
                    { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 16] },
                    { origin: [-8, 12, -2], size: [4, 12, 4], uv: [40, 32], inflate: 0.25 }
                ]
            },
            {
                name: 'leftLeg',
                parent: 'root',
                pivot: [1.9, 12, 0],
                cubes: [
                    { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [16, 48] },
                    { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 }
                ]
            },
            {
                name: 'rightLeg',
                parent: 'root',
                pivot: [-1.9, 12, 0],
                cubes: [
                    { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] },
                    { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 }
                ]
            }
        ]
    },
    'geometry.humanoid.customSlim': {
        description: {
            identifier: 'geometry.humanoid.customSlim',
            texture_width: 64,
            texture_height: 64,
            visible_bounds_width: 2,
            visible_bounds_height: 1.8,
            visible_bounds_offset: [0, 1.62, 0]
        },
        bones: [
            {
                name: 'root',
                pivot: [0, 0, 0]
            },
            {
                name: 'waist',
                parent: 'root',
                pivot: [0, 12, 0]
            },
            {
                name: 'body',
                parent: 'waist',
                pivot: [0, 24, 0],
                cubes: [
                    { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 16] },
                    { origin: [-4, 12, -2], size: [8, 12, 4], uv: [16, 32], inflate: 0.25 }
                ]
            },
            {
                name: 'head',
                parent: 'body',
                pivot: [0, 24, 0],
                cubes: [
                    { origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] },
                    { origin: [-4, 24, -4], size: [8, 8, 8], uv: [32, 0], inflate: 0.5 }
                ]
            },
            {
                name: 'rightArm',
                parent: 'body',
                pivot: [-5, 21.5, 0],
                cubes: [
                    { origin: [-7, 11.5, -2], size: [3, 12, 4], uv: [40, 16] },
                    { origin: [-7, 11.5, -2], size: [3, 12, 4], uv: [40, 32], inflate: 0.25 }
                ]
            },
            {
                name: 'leftArm',
                parent: 'body',
                pivot: [5, 21.5, 0],
                cubes: [
                    { origin: [4, 11.5, -2], size: [3, 12, 4], uv: [32, 48] },
                    { origin: [4, 11.5, -2], size: [3, 12, 4], uv: [48, 48], inflate: 0.25 }
                ]
            },
            {
                name: 'rightLeg',
                parent: 'root',
                pivot: [-1.9, 12, 0],
                cubes: [
                    { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 16] },
                    { origin: [-3.9, 0, -2], size: [4, 12, 4], uv: [0, 32], inflate: 0.25 }
                ]
            },
            {
                name: 'leftLeg',
                parent: 'root',
                pivot: [1.9, 12, 0],
                cubes: [
                    { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [16, 48] },
                    { origin: [-0.1, 0, -2], size: [4, 12, 4], uv: [0, 48], inflate: 0.25 }
                ]
            }
        ]
    }
};

window.SkinApex = SkinApex;
