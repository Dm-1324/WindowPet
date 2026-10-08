/*
 * Single-image avatar support.
 *
 * Instead of a hand-drawn sprite sheet, an avatar pet is ONE picture. At load time we
 * draw that picture many times onto a canvas with small transforms (bounce, squash,
 * tilt, flip, rotate onto walls...) and register the result as a normal sprite sheet.
 * Because the output looks exactly like any other pet's sprite sheet, the existing
 * movement engine in Pets.ts (walking, gravity, climbing, dragging) works unchanged.
 */

export interface IAvatarOptions {
    // height of the character on screen (CSS px) when the pet scale slider is at its default
    height?: number;
    // "auto" removes a flat background colour if the image has no transparency
    removeBackground?: boolean | "auto";
}

type Anchor = "ground" | "center" | "wall" | "ceiling";

interface IPose {
    dx?: number; // horizontal shift, as a fraction of character height
    dy?: number; // vertical shift, as a fraction of character height (negative = up)
    rot?: number; // radians, positive = clockwise
    sx?: number; // horizontal scale
    sy?: number; // vertical scale
}

interface IAvatarStateDef {
    state: string;
    frames: number;
    frameRate: number;
    anchor: Anchor;
    pose: (t: number, i: number, n: number) => IPose;
}

const TAU = Math.PI * 2;

// Every state the avatar supports. Order defines the frame layout of the generated sheet.
export const AVATAR_STATE_DEFS: IAvatarStateDef[] = [
    {
        state: "stand", frames: 8, frameRate: 6, anchor: "ground",
        pose: (t) => {
            const s = Math.sin(TAU * t);
            return { sy: 1 + 0.025 * s, sx: 1 - 0.012 * s };
        },
    },
    {
        state: "idle", frames: 8, frameRate: 6, anchor: "ground",
        pose: (t) => ({
            rot: 0.04 * Math.sin(TAU * t),
            sy: 1 + 0.015 * Math.sin(2 * TAU * t),
        }),
    },
    {
        state: "walk", frames: 8, frameRate: 12, anchor: "ground",
        pose: (t) => {
            const bob = Math.abs(Math.sin(TAU * t));
            return {
                dy: -0.045 * bob,
                rot: 0.03 + 0.05 * Math.sin(TAU * t),
                sy: 0.97 + 0.05 * bob,
                sx: 1.02 - 0.03 * bob,
            };
        },
    },
    {
        state: "sit", frames: 6, frameRate: 5, anchor: "ground",
        pose: (t) => ({ sy: 0.87 + 0.015 * Math.sin(TAU * t), sx: 1.06 }),
    },
    {
        state: "sleep", frames: 8, frameRate: 4, anchor: "ground",
        pose: (t) => ({ sy: 0.85 + 0.02 * Math.sin(TAU * t), sx: 1.07, rot: 0.12 }),
    },
    {
        state: "greet", frames: 12, frameRate: 12, anchor: "ground",
        pose: (t) => {
            // a happy hop, then a little side-to-side wiggle
            if (t < 0.5) {
                const p = t / 0.5;
                const hop = Math.sin(Math.PI * p);
                return { dy: -0.15 * hop, sy: 1 + 0.06 * hop, sx: 1 - 0.04 * hop };
            }
            const p = (t - 0.5) / 0.5;
            return { rot: 0.15 * Math.sin(2 * TAU * p) * (1 - p * 0.5) };
        },
    },
    {
        state: "dance", frames: 12, frameRate: 12, anchor: "ground",
        pose: (t) => {
            const ph = TAU * t;
            return {
                rot: 0.2 * Math.sin(ph),
                dx: 0.06 * Math.sin(ph),
                dy: -0.07 * Math.abs(Math.sin(2 * ph)),
                sy: 1 - 0.04 * Math.cos(4 * ph),
                sx: 1 + 0.03 * Math.cos(4 * ph),
            };
        },
    },
    {
        state: "spin", frames: 10, frameRate: 14, anchor: "ground",
        pose: (t) => {
            const c = Math.cos(TAU * t);
            return {
                sx: Math.sign(c || 1) * Math.max(Math.abs(c), 0.06),
                dy: -0.08 * Math.sin(Math.PI * t),
            };
        },
    },
    {
        state: "jump", frames: 2, frameRate: 4, anchor: "ground",
        pose: (_t, i) => ({ sy: i === 0 ? 1.07 : 1.04, sx: i === 0 ? 0.94 : 0.96 }),
    },
    {
        state: "fall", frames: 5, frameRate: 12, anchor: "ground",
        pose: (_t, i) => {
            // landing squash: played once when the pet hits the ground
            const sy = [0.72, 0.84, 1.07, 0.97, 1][i];
            return { sy, sx: 1 / Math.pow(sy, 0.7) };
        },
    },
    {
        state: "drag", frames: 8, frameRate: 10, anchor: "center",
        pose: (t) => ({ rot: 0.28 * Math.sin(TAU * t), sy: 1.04, sx: 0.98 }),
    },
    {
        state: "climb", frames: 6, frameRate: 10, anchor: "wall",
        pose: (t) => ({ dx: 0.03 * Math.sin(TAU * t), rot: 0.05 * Math.sin(TAU * t) }),
    },
    {
        state: "crawl", frames: 6, frameRate: 10, anchor: "ceiling",
        pose: (t) => ({ dx: 0.03 * Math.sin(TAU * t), rot: 0.05 * Math.sin(TAU * t) }),
    },
];

// states in the config format the rest of the app expects (1-based start/end frame)
export const AVATAR_STATES: { [state: string]: { start: number; end: number } } = (() => {
    const states: { [state: string]: { start: number; end: number } } = {};
    let next = 1;
    for (const def of AVATAR_STATE_DEFS) {
        states[def.state] = { start: next, end: next + def.frames - 1 };
        next += def.frames;
    }
    return states;
})();

const TOTAL_FRAMES = AVATAR_STATE_DEFS.reduce((sum, d) => sum + d.frames, 0);
const MAX_TEXTURE_SIZE = 4096;
const DEFAULT_HEIGHT = 170;

export interface IAvatarSheet {
    canvas: HTMLCanvasElement;
    frameSize: number;
    columns: number;
    // where the top of the character's head sits in a standing frame, 0..1 from the top
    headTopRatio: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    return ctx;
}

// Remove a flat background colour by flood-filling from the image border.
function removeFlatBackground(c: HTMLCanvasElement, mode: boolean | "auto"): void {
    if (mode === false) return;
    const ctx = context(c);
    const { width: w, height: h } = c;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const px = (x: number, y: number) => (y * w + x) * 4;

    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    if (mode === "auto") {
        // image already has transparency -> leave it alone
        if (corners.some((i) => d[i + 3] < 250)) return;
        // corners must share a colour for it to look like a background
        const [r, g, b] = [d[corners[0]], d[corners[0] + 1], d[corners[0] + 2]];
        const same = corners.every(
            (i) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 40
        );
        if (!same) return;
    }

    const bg = [d[corners[0]], d[corners[0] + 1], d[corners[0] + 2]];
    const tolerance = 60;
    const seen = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
    for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);

    while (stack.length) {
        const p = stack.pop()!;
        if (seen[p]) continue;
        seen[p] = 1;
        const i = p * 4;
        const diff = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
        if (diff > tolerance) continue;
        // soften the edge a little instead of a hard cut
        d[i + 3] = diff < tolerance * 0.5 ? 0 : Math.round(d[i + 3] * (diff / tolerance));
        const x = p % w;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (p >= w) stack.push(p - w);
        if (p < w * (h - 1)) stack.push(p + w);
    }
    ctx.putImageData(img, 0, 0);
}

// Crop away fully transparent margins so the feet really touch the ground.
function trimTransparent(c: HTMLCanvasElement): HTMLCanvasElement {
    const ctx = context(c);
    const { width: w, height: h } = c;
    const d = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (d[(y * w + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return c; // fully transparent, nothing to trim
    const out = makeCanvas(maxX - minX + 1, maxY - minY + 1);
    context(out).drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out;
}

// High quality downscale: halve repeatedly, then do the final resize.
function resample(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
    let cur = src;
    while (cur.width / 2 >= w && cur.height / 2 >= h) {
        const half = makeCanvas(cur.width / 2, cur.height / 2);
        context(half).drawImage(cur, 0, 0, half.width, half.height);
        cur = half;
    }
    const out = makeCanvas(w, h);
    context(out).drawImage(cur, 0, 0, out.width, out.height);
    return out;
}

// `pixelScale` is how many texture pixels per on-screen pixel (e.g. devicePixelRatio)
export function buildAvatarSheet(
    source: CanvasImageSource & { width: number; height: number },
    options: IAvatarOptions = {},
    pixelScale: number = 1
): IAvatarSheet {
    // 1. copy source so we can read pixels, clean it up and trim it
    let base = makeCanvas(source.width, source.height);
    context(base).drawImage(source, 0, 0);
    try {
        removeFlatBackground(base, options.removeBackground ?? "auto");
        base = trimTransparent(base);
    } catch (err) {
        // pixel access can fail for cross-origin images; draw the image as-is
        console.warn("Avatar cleanup skipped:", err);
    }

    // 2. decide the size of the character and of each frame
    let h = Math.round((options.height ?? DEFAULT_HEIGHT) * pixelScale);
    let w = Math.round((h * base.width) / base.height);
    const maxW = h * 1.6;
    if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = Math.round(maxW);
    }
    const columns = Math.ceil(Math.sqrt(TOTAL_FRAMES));
    const rows = Math.ceil(TOTAL_FRAMES / columns);
    let frameSize = Math.ceil(Math.max(h * 1.3, w + h * 0.45));
    const maxFrame = Math.floor(MAX_TEXTURE_SIZE / columns);
    if (frameSize > maxFrame) {
        const k = maxFrame / frameSize;
        h = Math.floor(h * k);
        w = Math.floor(w * k);
        frameSize = maxFrame;
    }
    const margin = Math.max(1, Math.round(frameSize * 0.01));
    const sprite = resample(base, w, h);

    // 3. draw every frame
    const sheet = makeCanvas(columns * frameSize, rows * frameSize);
    const ctx = context(sheet);
    let index = 0;
    for (const def of AVATAR_STATE_DEFS) {
        for (let i = 0; i < def.frames; i++, index++) {
            const fx = (index % columns) * frameSize;
            const fy = Math.floor(index / columns) * frameSize;
            const p = def.pose(i / def.frames, i, def.frames);

            ctx.save();
            ctx.beginPath();
            ctx.rect(fx, fy, frameSize, frameSize);
            ctx.clip();

            // pivot + base rotation per anchor; the character is drawn "standing" on the pivot
            let pivotX = fx + frameSize / 2;
            let pivotY = fy + frameSize - margin;
            let baseRot = 0;
            if (def.anchor === "wall") {
                // feet against the right wall (Pets.ts mirrors it for the left wall)
                pivotX = fx + frameSize - margin;
                pivotY = fy + frameSize / 2;
                baseRot = -Math.PI / 2;
            } else if (def.anchor === "ceiling") {
                pivotY = fy + margin;
                baseRot = Math.PI;
            } else if (def.anchor === "center") {
                pivotY = fy + frameSize / 2 + h / 2;
            }

            ctx.translate(pivotX, pivotY);
            ctx.rotate(baseRot);
            ctx.translate((p.dx ?? 0) * h, (p.dy ?? 0) * h);
            if (def.anchor === "center") {
                // swing around the middle of the body, not the feet
                ctx.translate(0, -h / 2);
                ctx.rotate(p.rot ?? 0);
                ctx.scale(p.sx ?? 1, p.sy ?? 1);
                ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
            } else {
                ctx.rotate(p.rot ?? 0);
                ctx.scale(p.sx ?? 1, p.sy ?? 1);
                ctx.drawImage(sprite, -w / 2, -h, w, h);
            }
            ctx.restore();
        }
    }

    return {
        canvas: sheet,
        frameSize,
        columns,
        headTopRatio: (frameSize - margin - h) / frameSize,
    };
}

// ---------- Phaser glue ----------

export const avatarSourceKey = (name: string) => `${name}__avatar_src`;

// per texture key: metadata used by Pets.ts (emote placement, base scale)
export const avatarMeta: Map<string, { headTopRatio: number; frameSize: number }> = new Map();

/*
 * Builds the sprite sheet texture `name` from the already loaded source image and
 * registers one animation per state. Returns the frame size, or null if not ready.
 */
export function createAvatarTexture(
    textures: Phaser.Textures.TextureManager,
    anims: Phaser.Animations.AnimationManager,
    name: string,
    options: IAvatarOptions = {}
): number | null {
    if (textures.exists(name)) return avatarMeta.get(name)?.frameSize ?? null;
    const srcKey = avatarSourceKey(name);
    if (!textures.exists(srcKey)) return null;

    const source = textures.get(srcKey).getSourceImage() as HTMLImageElement;
    const sheet = buildAvatarSheet(source, options, 1);

    const tex = textures.addCanvas(name, sheet.canvas)!;
    for (let i = 0; i < TOTAL_FRAMES; i++) {
        tex.add(
            i,
            0,
            (i % sheet.columns) * sheet.frameSize,
            Math.floor(i / sheet.columns) * sheet.frameSize,
            sheet.frameSize,
            sheet.frameSize
        );
    }

    for (const def of AVATAR_STATE_DEFS) {
        const key = `${def.state}-${name}`;
        if (anims.exists(key)) continue;
        const range = AVATAR_STATES[def.state];
        anims.create({
            key,
            frames: anims.generateFrameNumbers(name, {
                start: range.start - 1,
                end: range.end - 1,
            }),
            frameRate: def.frameRate,
            repeat: -1,
        });
    }

    avatarMeta.set(name, { headTopRatio: sheet.headTopRatio, frameSize: sheet.frameSize });
    return sheet.frameSize;
}
