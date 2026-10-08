/*
 * Single-image avatar support.
 *
 * An avatar pet is ONE picture (optionally with a light "rig": eye positions and
 * separate arm/foot pieces). At load time we draw it many times onto a canvas with
 * small transforms, blinking eyes, moving limbs and props (bed, laptop, controller),
 * and register the result as a normal sprite sheet. Because the output looks exactly
 * like any other pet's sprite sheet, the movement engine in Pets.ts works unchanged.
 */

// ---------- config ----------

export interface IAvatarEye {
    // centre and radii of the eye, in pixels of the original image
    x: number;
    y: number;
    rx: number;
    ry: number;
}

export type LimbName = "armL" | "armR" | "legL" | "legR";

export interface IAvatarPart {
    // armL/armR/legL/legR, "L" = on the viewer's left
    name: LimbName;
    src: string;
    // where the part's image sits, in pixels of the original image
    x: number;
    y: number;
    // the joint (shoulder / hip) inside the part's own image
    pivotX: number;
    pivotY: number;
    // draw behind the body instead of in front
    behind?: boolean;
}

export interface IBubbleStyle {
    fill?: string;
    stroke?: string;
    text?: string;
    font?: string;
    fontSize?: number;
}

export interface IAvatarPersonality {
    // greeting lines; "{time}" is replaced with morning / afternoon / evening / night
    greetings?: string[];
    // relative chance of each idle behaviour (0 disables it)
    weights?: { [state: string]: number };
    // [min, max] seconds for long activities
    durations?: { [state: string]: [number, number] };
    // multiply the sleep weight at night (22:00-06:00)
    nightSleepBoost?: number;
    // minutes without hover/click before it starts seeking attention (0 = never)
    attentionAfter?: number;
    // global keyboard shortcuts, e.g. { "sleep": "CommandOrControl+Alt+S" }
    hotkeys?: { [action: string]: string };
    bubble?: IBubbleStyle;
}

export interface IAvatarOptions {
    // height of the character on screen (CSS px) when the pet scale slider is at its default
    height?: number;
    // "auto" removes a flat background colour if the image has no transparency
    removeBackground?: boolean | "auto";
    // rig: eyes enable blinking, parts enable arm / foot motion
    eyes?: IAvatarEye[];
    // colour for closed-eye lines (default: dark purple-brown)
    eyeLineColor?: string;
    // colour painted over an open eye when it closes (default: sampled around the eye)
    eyelidColor?: string;
    parts?: IAvatarPart[];
    personality?: IAvatarPersonality;
}

// ---------- poses ----------

type Anchor = "ground" | "center" | "wall" | "ceiling" | "bed";
type Eyes = "open" | "closed" | "happy" | "sleep" | "angry" | "sad";
type Prop = "laptop" | "controller" | "bed" | "popcorn";

interface ILimbPose {
    raise?: number; // radians, positive lifts the limb up/outwards
    dx?: number; // fraction of character height
    dy?: number;
}

interface IPose {
    dx?: number; // horizontal shift, as a fraction of character height
    dy?: number; // vertical shift, as a fraction of character height (negative = up)
    rot?: number; // radians, positive = clockwise
    sx?: number;
    sy?: number;
    eyes?: Eyes;
    limbs?: { [name in LimbName]?: ILimbPose };
    prop?: Prop;
    // 0..1 animation phase handed to the prop (screen flicker, breathing blanket...)
    propPhase?: number;
    // coloured light falling on the character (e.g. a movie screen), "r,g,b,a"
    light?: string;
    // flat colour wash over the whole character, "r,g,b,a" (e.g. red with anger)
    tint?: string;
}

interface IAvatarStateDef {
    state: string;
    frames: number;
    frameRate: number;
    anchor: Anchor;
    pose: (t: number, i: number, n: number) => IPose;
}

const TAU = Math.PI * 2;
const sin = Math.sin;
const cos = Math.cos;

// eyes closed on frame `at` of a loop (a quick, natural blink)
const blink = (i: number, at: number[]): Eyes => (at.includes(i) ? "closed" : "open");

const walkLimbs = (ph: number, amount = 1) => ({
    armL: { raise: 0.35 * amount * sin(ph) },
    armR: { raise: -0.35 * amount * sin(ph) },
    legL: { dy: -0.035 * amount * Math.max(0, sin(ph)) },
    legR: { dy: -0.035 * amount * Math.max(0, -sin(ph)) },
});

// Every state the avatar supports. Order defines the frame layout of the generated sheet.
export const AVATAR_STATE_DEFS: IAvatarStateDef[] = [
    {
        state: "stand", frames: 24, frameRate: 8, anchor: "ground",
        pose: (t, i) => {
            const s = sin(TAU * t);
            return {
                sy: 1 + 0.02 * s, sx: 1 - 0.01 * s,
                eyes: blink(i, [17]),
                limbs: { armL: { raise: 0.06 * s }, armR: { raise: 0.06 * s } },
            };
        },
    },
    {
        state: "idle", frames: 24, frameRate: 8, anchor: "ground",
        pose: (t, i) => ({
            // looks around: leans one way, then the other
            rot: 0.05 * sin(TAU * t),
            sy: 1 + 0.012 * sin(2 * TAU * t),
            eyes: blink(i, [5, 19]),
            limbs: { armL: { raise: 0.15 * Math.max(0, sin(TAU * t)) }, armR: { raise: 0.15 * Math.max(0, -sin(TAU * t)) } },
        }),
    },
    {
        state: "walk", frames: 24, frameRate: 12, anchor: "ground",
        pose: (t, i) => {
            // two steps per cycle
            const ph = 2 * TAU * t;
            const bob = Math.abs(sin(ph));
            return {
                dy: -0.04 * bob,
                rot: 0.03 + 0.04 * sin(ph),
                sy: 0.975 + 0.04 * bob,
                sx: 1.015 - 0.025 * bob,
                eyes: blink(i, [20]),
                limbs: walkLimbs(ph),
            };
        },
    },
    {
        state: "sit", frames: 24, frameRate: 6, anchor: "ground",
        pose: (t, i) => ({
            sy: 0.87 + 0.012 * sin(TAU * t), sx: 1.06,
            eyes: blink(i, [9]),
            // legs stretched out, arms resting
            limbs: { legL: { dy: -0.015 }, legR: { dy: -0.015 }, armL: { raise: -0.15 }, armR: { raise: -0.15 } },
            rot: i >= 14 && i <= 19 ? 0.06 : 0, // looks to the side for a moment
        }),
    },
    {
        state: "sleep", frames: 16, frameRate: 4, anchor: "bed",
        pose: (t) => ({
            sy: 1 + 0.015 * sin(TAU * t),
            eyes: "sleep",
            limbs: { armL: { raise: -1.2 }, armR: { raise: -1.2 } },
            prop: "bed",
            propPhase: t,
        }),
    },
    {
        state: "laptop", frames: 24, frameRate: 8, anchor: "ground",
        pose: (t, i) => {
            const typing = i % 2 === 0 ? 1 : -1;
            const thinking = i >= 16 && i <= 20; // pauses, looks up to think
            return {
                sy: 0.87, sx: 1.06,
                rot: thinking ? -0.05 : 0.02,
                eyes: thinking ? blink(i, [18]) : "open",
                limbs: thinking
                    ? { armL: { raise: -0.1 }, armR: { raise: 0.9 } }
                    : { armL: { raise: 0.25, dy: 0.012 * typing }, armR: { raise: 0.25, dy: -0.012 * typing } },
                prop: "laptop",
                propPhase: t,
            };
        },
    },
    {
        state: "game", frames: 24, frameRate: 10, anchor: "ground",
        pose: (t, i) => {
            const mash = i % 2 === 0 ? 1 : -1;
            const win = i >= 18; // little victory wiggle at the end of each round
            return {
                sy: win ? 0.9 + 0.03 * sin(TAU * (i - 18) / 6) : 0.87,
                sx: 1.05,
                rot: win ? 0.08 * sin(TAU * (i - 18) / 3) : 0.03 * sin(TAU * t * 2),
                dy: win ? -0.03 * Math.abs(sin(TAU * (i - 18) / 6)) : 0,
                eyes: win ? "happy" : blink(i, [7]),
                limbs: {
                    armL: { raise: win ? 1.2 : 0.4, dy: win ? 0 : 0.01 * mash },
                    armR: { raise: win ? 1.2 : 0.4, dy: win ? 0 : -0.01 * mash },
                },
                prop: win ? undefined : "controller",
                propPhase: t,
            };
        },
    },
    {
        state: "movie", frames: 24, frameRate: 8, anchor: "ground",
        pose: (t, i) => {
            const eating = i >= 4 && i <= 8; // hand to mouth, chew
            const laughing = i >= 16 && i <= 21;
            const shake = laughing ? 0.05 * sin(TAU * (i - 16) / 3) : 0;
            // screen light: shifts colour as scenes change
            const lights = ["120,170,255", "255,255,255", "190,130,255", "120,220,255", "255,200,140", "255,255,255"];
            return {
                sy: 0.87 + (eating ? 0.015 * sin(TAU * i / 2) : 0), sx: 1.06,
                rot: shake,
                eyes: laughing ? "happy" : blink(i, [12]),
                limbs: {
                    armL: { raise: 0.35 },
                    armR: { raise: eating ? 1.25 : 0.3 },
                },
                prop: "popcorn",
                propPhase: t,
                light: `${lights[Math.floor(i / 4) % lights.length]},${0.1 + 0.05 * sin(TAU * t * 5)}`,
            };
        },
    },
    {
        state: "angry", frames: 16, frameRate: 12, anchor: "ground",
        pose: (t, i) => {
            const stomp = i % 4 < 2;
            return {
                dx: (i % 2 === 0 ? 1 : -1) * 0.012, // trembling with rage
                sx: 1.07, sy: stomp ? 0.95 : 1.0,
                eyes: "angry",
                tint: "255,50,40,0.2",
                limbs: {
                    armL: { raise: 0.85 + 0.2 * sin(TAU * t * 4) },
                    armR: { raise: 0.85 - 0.2 * sin(TAU * t * 4) },
                    legL: { dy: stomp && i % 8 < 4 ? -0.05 : 0 },
                    legR: { dy: stomp && i % 8 >= 4 ? -0.05 : 0 },
                },
            };
        },
    },
    {
        state: "sad", frames: 24, frameRate: 6, anchor: "ground",
        pose: (t, i) => ({
            sy: i === 10 || i === 11 ? 0.9 : 0.93, // sniff
            sx: 1.03,
            rot: 0.035 * sin(TAU * t),
            dy: 0,
            eyes: "sad",
            limbs: { armL: { raise: -0.3 }, armR: { raise: i >= 14 && i <= 18 ? 1.1 : -0.3 } }, // wipes a tear
        }),
    },
    {
        state: "attention", frames: 16, frameRate: 12, anchor: "ground",
        pose: (t, i) => {
            const hop = Math.abs(sin(2 * TAU * t));
            return {
                dy: -0.12 * hop,
                sy: 0.95 + 0.08 * hop, sx: 1.04 - 0.05 * hop,
                rot: 0.06 * sin(TAU * t),
                eyes: i % 8 < 4 ? "happy" : "open",
                limbs: {
                    armL: { raise: 1.5 + 0.45 * sin(2 * TAU * t) },
                    armR: { raise: 1.5 - 0.45 * sin(2 * TAU * t) },
                    legL: { dy: -0.03 * hop },
                    legR: { dy: -0.03 * hop },
                },
            };
        },
    },
    {
        state: "greet", frames: 16, frameRate: 12, anchor: "ground",
        pose: (t) => {
            // a happy hop, then a wave
            if (t < 0.4) {
                const hop = sin(Math.PI * (t / 0.4));
                return {
                    dy: -0.14 * hop, sy: 1 + 0.05 * hop, sx: 1 - 0.04 * hop,
                    eyes: "happy",
                    limbs: { armL: { raise: 0.9 * hop }, armR: { raise: 0.9 * hop } },
                };
            }
            const p = (t - 0.4) / 0.6;
            return {
                rot: 0.06 * sin(2 * TAU * p),
                eyes: "happy",
                limbs: { armR: { raise: 1.3 + 0.4 * sin(3 * TAU * p) }, armL: { raise: 0.1 } },
            };
        },
    },
    {
        state: "dance", frames: 16, frameRate: 12, anchor: "ground",
        pose: (t) => {
            const ph = TAU * t;
            return {
                rot: 0.2 * sin(ph),
                dx: 0.06 * sin(ph),
                dy: -0.07 * Math.abs(sin(2 * ph)),
                sy: 1 - 0.04 * cos(4 * ph),
                sx: 1 + 0.03 * cos(4 * ph),
                eyes: t < 0.5 ? "happy" : "open",
                limbs: {
                    armL: { raise: 0.6 + 0.9 * Math.max(0, sin(ph)) },
                    armR: { raise: 0.6 + 0.9 * Math.max(0, -sin(ph)) },
                    legL: { dy: -0.05 * Math.max(0, sin(2 * ph)) },
                    legR: { dy: -0.05 * Math.max(0, -sin(2 * ph)) },
                },
            };
        },
    },
    {
        state: "spin", frames: 10, frameRate: 14, anchor: "ground",
        pose: (t) => {
            const c = cos(TAU * t);
            return {
                sx: Math.sign(c || 1) * Math.max(Math.abs(c), 0.06),
                dy: -0.08 * sin(Math.PI * t),
                eyes: "happy",
                limbs: { armL: { raise: 1.0 }, armR: { raise: 1.0 } },
            };
        },
    },
    {
        state: "jump", frames: 2, frameRate: 4, anchor: "ground",
        pose: (_t, i) => ({
            sy: i === 0 ? 1.07 : 1.04, sx: i === 0 ? 0.94 : 0.96,
            eyes: "closed",
            limbs: { armL: { raise: 1.3 }, armR: { raise: 1.3 }, legL: { dy: -0.02 }, legR: { dy: -0.02 } },
        }),
    },
    {
        state: "fall", frames: 5, frameRate: 12, anchor: "ground",
        pose: (_t, i) => {
            // landing squash: played once when the pet hits the ground
            const sy = [0.72, 0.84, 1.07, 0.97, 1][i];
            const arms = [1.2, 0.8, 0.3, 0.1, 0][i];
            return {
                sy, sx: 1 / Math.pow(sy, 0.7),
                eyes: i < 2 ? "closed" : "open",
                limbs: { armL: { raise: arms }, armR: { raise: arms } },
            };
        },
    },
    {
        state: "drag", frames: 8, frameRate: 10, anchor: "center",
        pose: (t) => ({
            rot: 0.28 * sin(TAU * t), sy: 1.04, sx: 0.98,
            eyes: "closed",
            limbs: {
                armL: { raise: 1.4 + 0.3 * sin(2 * TAU * t) },
                armR: { raise: 1.4 - 0.3 * sin(2 * TAU * t) },
                legL: { dy: 0.02 * sin(2 * TAU * t) },
                legR: { dy: -0.02 * sin(2 * TAU * t) },
            },
        }),
    },
    {
        state: "climb", frames: 8, frameRate: 10, anchor: "wall",
        pose: (t) => ({
            dx: 0.03 * sin(TAU * t), rot: 0.04 * sin(TAU * t),
            limbs: walkLimbs(TAU * t, 1.4),
        }),
    },
    {
        state: "crawl", frames: 8, frameRate: 10, anchor: "ceiling",
        pose: (t) => ({
            dx: 0.03 * sin(TAU * t), rot: 0.04 * sin(TAU * t),
            limbs: walkLimbs(TAU * t, 1.4),
        }),
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
const DEFAULT_HEIGHT = 120;

// ---------- image helpers ----------

export interface IAvatarSheet {
    canvas: HTMLCanvasElement;
    frameSize: number;
    columns: number;
    // where the top of the head sits in a standing frame, 0..1 from the top
    headTopRatio: number;
    // where the head is in the sleeping (bed) frames, 0..1 of the frame
    sleepHead: { x: number; y: number };
}

type Img = CanvasImageSource & { width: number; height: number };

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

function copyOf(img: Img): HTMLCanvasElement {
    const c = makeCanvas(img.width, img.height);
    context(c).drawImage(img, 0, 0);
    return c;
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
        if (corners.some((i) => d[i + 3] < 250)) return; // already transparent
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
        d[i + 3] = diff < tolerance * 0.5 ? 0 : Math.round(d[i + 3] * (diff / tolerance));
        const x = p % w;
        if (x > 0) stack.push(p - 1);
        if (x < w - 1) stack.push(p + 1);
        if (p >= w) stack.push(p - w);
        if (p < w * (h - 1)) stack.push(p + w);
    }
    ctx.putImageData(img, 0, 0);
}

interface IBox { x: number; y: number; w: number; h: number }

function opaqueBounds(c: HTMLCanvasElement): IBox | null {
    const { width: w, height: h } = c;
    const d = context(c).getImageData(0, 0, w, h).data;
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
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
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

function crop(src: HTMLCanvasElement, b: IBox): HTMLCanvasElement {
    const out = makeCanvas(b.w, b.h);
    context(out).drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
    return out;
}

// median colour of opaque pixels in a ring around the eye = skin colour for the eyelid
function sampleAround(c: HTMLCanvasElement, eye: IAvatarEye): string {
    const ctx = context(c);
    const rs: number[] = [], gs: number[] = [], bs: number[] = [];
    for (let a = 0; a < TAU; a += TAU / 48) {
        for (const k of [1.35, 1.6]) {
            const x = Math.round(eye.x + cos(a) * eye.rx * k);
            const y = Math.round(eye.y + sin(a) * eye.ry * k);
            if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
            const p = ctx.getImageData(x, y, 1, 1).data;
            if (p[3] < 200) continue;
            rs.push(p[0]); gs.push(p[1]); bs.push(p[2]);
        }
    }
    if (rs.length === 0) return "#f2c9a0";
    const med = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length / 2)];
    return `rgb(${med(rs)},${med(gs)},${med(bs)})`;
}

// copy of the body with the eyes drawn closed / happy / sleeping
function eyeVariant(base: HTMLCanvasElement, opts: IAvatarOptions, kind: Eyes): HTMLCanvasElement {
    if (kind === "open") return base;
    if (!opts.eyes?.length && kind !== "angry") return base;
    const c = copyOf(base);
    const ctx = context(c);
    const line = opts.eyeLineColor ?? "#3c2846";

    if (kind === "angry") {
        // eyes stay open, with furrowed brows slanting down towards the middle
        const eyes = opts.eyes ?? [];
        const mid = eyes.reduce((sum, e) => sum + e.x, 0) / Math.max(1, eyes.length);
        ctx.strokeStyle = line;
        ctx.lineCap = "round";
        for (const e of eyes) {
            const inner = e.x < mid ? 1 : -1;
            ctx.lineWidth = Math.max(2, Math.min(e.rx, e.ry) * 0.45);
            ctx.beginPath();
            ctx.moveTo(e.x - inner * e.rx * 1.1, e.y - e.ry * 1.55);
            ctx.lineTo(e.x + inner * e.rx * 1.0, e.y - e.ry * 1.0);
            ctx.stroke();
        }
        return c;
    }

    for (const e of opts.eyes!) {
        ctx.fillStyle = opts.eyelidColor ?? sampleAround(base, e);
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, e.rx * 1.18, e.ry * 1.15, 0, 0, TAU);
        ctx.fill();

        ctx.strokeStyle = line;
        ctx.lineWidth = Math.max(2, Math.min(e.rx, e.ry) * 0.38);
        ctx.lineCap = "round";
        ctx.beginPath();
        if (kind === "sad") {
            // squeezed-shut eyes, worried brows (raised in the middle), a big tear
            const eyes = opts.eyes!;
            const mid = eyes.reduce((sum, o) => sum + o.x, 0) / eyes.length;
            const inner = e.x < mid ? 1 : -1;
            ctx.moveTo(e.x - e.rx, e.y);
            ctx.quadraticCurveTo(e.x, e.y + e.ry * 0.55, e.x + e.rx, e.y);
            ctx.moveTo(e.x - inner * e.rx * 1.1, e.y - e.ry * 1.0);
            ctx.lineTo(e.x + inner * e.rx * 0.9, e.y - e.ry * 1.5);
            ctx.stroke();

            const tx = e.x + inner * -e.rx * 0.55; // tear on the outer side
            const ty = e.y + e.ry * 0.55;
            const r = Math.max(e.rx, e.ry) * 0.42;
            ctx.fillStyle = "rgba(95,170,255,0.95)";
            ctx.strokeStyle = "rgba(40,110,210,0.9)";
            ctx.lineWidth = Math.max(1, r * 0.18);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.quadraticCurveTo(tx + r * 0.9, ty + r * 1.4, tx, ty + r * 1.9);
            ctx.quadraticCurveTo(tx - r * 0.9, ty + r * 1.4, tx, ty);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.8)";
            ctx.beginPath();
            ctx.arc(tx - r * 0.2, ty + r * 1.3, r * 0.18, 0, TAU);
            ctx.fill();
            continue;
        }
        if (kind === "happy") {
            // ^ ^
            ctx.moveTo(e.x - e.rx, e.y + e.ry * 0.25);
            ctx.quadraticCurveTo(e.x, e.y - e.ry * 0.95, e.x + e.rx, e.y + e.ry * 0.25);
        } else {
            // closed: a soft downward curve; sleeping adds little lashes
            const y = kind === "sleep" ? e.y + e.ry * 0.15 : e.y;
            ctx.moveTo(e.x - e.rx, y);
            ctx.quadraticCurveTo(e.x, y + e.ry * 0.7, e.x + e.rx, y);
            if (kind === "sleep") {
                ctx.moveTo(e.x - e.rx * 0.9, y + e.ry * 0.12);
                ctx.lineTo(e.x - e.rx * 1.25, y + e.ry * 0.35);
                ctx.moveTo(e.x + e.rx * 0.9, y + e.ry * 0.12);
                ctx.lineTo(e.x + e.rx * 1.25, y + e.ry * 0.35);
            }
        }
        ctx.stroke();
    }
    return c;
}

// ---------- props (drawn in frame space, h = character height, w = width) ----------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

function drawLaptop(ctx: CanvasRenderingContext2D, cx: number, ground: number, h: number, w: number, phase: number) {
    const lw = Math.min(w * 0.85, h * 0.8);
    const lh = h * 0.34;
    const top = ground - h * 0.05 - lh;

    // screen light spilling over the top edge (flickers a little)
    const glow = 0.22 + 0.1 * sin(TAU * phase * 3);
    const g = ctx.createRadialGradient(cx, top, 2, cx, top, lw * 0.7);
    g.addColorStop(0, `rgba(190,235,255,${glow})`);
    g.addColorStop(1, "rgba(190,235,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - lw, top - lw * 0.7, lw * 2, lw * 0.9);

    // lid (we see its back)
    const lid = ctx.createLinearGradient(0, top, 0, top + lh);
    lid.addColorStop(0, "#c9d0d8");
    lid.addColorStop(1, "#98a2ad");
    ctx.fillStyle = lid;
    roundRect(ctx, cx - lw / 2, top, lw, lh, h * 0.03);
    ctx.fill();
    ctx.strokeStyle = "#6f7a86";
    ctx.lineWidth = Math.max(1, h * 0.01);
    ctx.stroke();

    // little logo
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(cx, top + lh * 0.45, h * 0.035, 0, TAU);
    ctx.fill();

    // base
    ctx.fillStyle = "#7d8792";
    roundRect(ctx, cx - lw * 0.56, ground - h * 0.055, lw * 1.12, h * 0.05, h * 0.02);
    ctx.fill();
}

function drawController(ctx: CanvasRenderingContext2D, cx: number, ground: number, h: number, w: number, phase: number) {
    const cw = Math.min(w * 0.7, h * 0.6);
    const ch = h * 0.17;
    const top = ground - h * 0.42;
    const cy = top + ch / 2;

    ctx.fillStyle = "#4b3f72";
    roundRect(ctx, cx - cw / 2, top, cw, ch, ch * 0.45);
    ctx.fill();
    ctx.strokeStyle = "#2c2448";
    ctx.lineWidth = Math.max(1, h * 0.01);
    ctx.stroke();

    // d-pad
    const s = ch * 0.16;
    ctx.fillStyle = "#e8e4f5";
    ctx.fillRect(cx - cw * 0.3 - s * 1.5, cy - s / 2, s * 3, s);
    ctx.fillRect(cx - cw * 0.3 - s / 2, cy - s * 1.5, s, s * 3);

    // buttons (one lights up as it's pressed)
    const pressed = Math.floor(phase * 12) % 4;
    const colors = ["#ff6b81", "#4dd0e1", "#ffd54f", "#81c784"];
    const offs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    offs.forEach(([ox, oy], k) => {
        ctx.fillStyle = colors[k];
        ctx.globalAlpha = k === pressed ? 1 : 0.7;
        ctx.beginPath();
        ctx.arc(cx + cw * 0.3 + ox * s * 1.3, cy + oy * s * 1.3, s * (k === pressed ? 0.75 : 0.6), 0, TAU);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

function drawPopcorn(ctx: CanvasRenderingContext2D, cx: number, ground: number, h: number, w: number, phase: number) {
    const bw = Math.min(w * 0.42, h * 0.36);
    const bh = h * 0.24;
    const top = ground - h * 0.36;
    const x = cx + w * 0.08; // held a little to one side
    // popcorn heaped on top (gently shifts as it's eaten)
    const puffs = [[-0.32, 0.02], [-0.12, -0.08], [0.1, -0.05], [0.3, 0.01], [0.0, 0.04], [-0.22, -0.02], [0.22, -0.1]];
    puffs.forEach(([px, py], k) => {
        ctx.fillStyle = k % 3 === 0 ? "#fff1c1" : "#fffaf0";
        ctx.strokeStyle = "#e7c56d";
        ctx.lineWidth = Math.max(1, h * 0.006);
        ctx.beginPath();
        ctx.arc(x + px * bw, top + py * bh + 0.01 * h * sin(TAU * phase + k), bw * 0.13, 0, TAU);
        ctx.fill();
        ctx.stroke();
    });
    // striped bucket (slightly wider at the top)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, top);
    ctx.lineTo(x + bw / 2, top);
    ctx.lineTo(x + bw * 0.38, top + bh);
    ctx.lineTo(x - bw * 0.38, top + bh);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "#e8433f";
    for (let k = -3; k <= 3; k += 2) ctx.fillRect(x + (k * bw) / 7 - bw / 14, top, bw / 7, bh);
    ctx.restore();
    ctx.strokeStyle = "#b92f2c";
    ctx.lineWidth = Math.max(1, h * 0.01);
    ctx.beginPath();
    ctx.moveTo(x - bw / 2, top);
    ctx.lineTo(x + bw / 2, top);
    ctx.lineTo(x + bw * 0.38, top + bh);
    ctx.lineTo(x - bw * 0.38, top + bh);
    ctx.closePath();
    ctx.stroke();
}

interface IBedLayout { x0: number; x1: number; mattressTop: number; pivotX: number; pivotY: number }

// the sleeping character is drawn at this fraction of its size so it fits in bed
const SLEEP_SCALE = 0.78;

function bedLayout(cx: number, ground: number, h: number, w: number): IBedLayout {
    const x0 = cx - h * 0.62;
    const x1 = cx + h * 0.62;
    const mattressTop = ground - h * 0.16;
    return {
        x0, x1, mattressTop,
        // the character's feet; it lies with its head on the pillow (left)
        pivotX: x0 + h * 0.1 + h * SLEEP_SCALE,
        pivotY: mattressTop - (w * SLEEP_SCALE) / 2 + h * 0.03,
    };
}

function drawBedBack(ctx: CanvasRenderingContext2D, b: IBedLayout, ground: number, h: number) {
    const wood = "#a9744f", woodDark = "#7a5236";
    // headboard + footboard
    ctx.fillStyle = wood;
    roundRect(ctx, b.x0, ground - h * 0.45, h * 0.07, h * 0.45, h * 0.03);
    ctx.fill();
    roundRect(ctx, b.x1 - h * 0.06, ground - h * 0.28, h * 0.06, h * 0.28, h * 0.03);
    ctx.fill();
    // mattress
    ctx.fillStyle = "#f3efe8";
    roundRect(ctx, b.x0 + h * 0.04, b.mattressTop, b.x1 - b.x0 - h * 0.08, h * 0.1, h * 0.03);
    ctx.fill();
    // frame
    ctx.fillStyle = woodDark;
    ctx.fillRect(b.x0 + h * 0.04, b.mattressTop + h * 0.09, b.x1 - b.x0 - h * 0.08, h * 0.05);
    // pillow
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#d9d3ea";
    ctx.lineWidth = Math.max(1, h * 0.01);
    ctx.beginPath();
    ctx.ellipse(b.x0 + h * 0.24, b.mattressTop - h * 0.035, h * 0.17, h * 0.07, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
}

function drawBlanket(ctx: CanvasRenderingContext2D, b: IBedLayout, h: number, w: number, phase: number) {
    const breathe = h * 0.012 * sin(TAU * phase);
    const left = b.pivotX - h * SLEEP_SCALE * 0.4;
    const right = b.x1 - h * 0.03;
    const top = b.pivotY - (w * SLEEP_SCALE) * 0.36 - breathe;
    const bottom = b.mattressTop + h * 0.07;

    ctx.fillStyle = "#8fb8ff";
    ctx.beginPath();
    ctx.moveTo(left, bottom);
    ctx.lineTo(left, top + h * 0.04);
    ctx.quadraticCurveTo(left, top, left + h * 0.06, top);
    ctx.quadraticCurveTo((left + right) / 2, top - h * 0.05 - breathe, right - h * 0.05, top + h * 0.02);
    ctx.quadraticCurveTo(right, top + h * 0.03, right, top + h * 0.08);
    ctx.lineTo(right, bottom);
    ctx.closePath();
    ctx.fill();
    // stripes
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    for (let x = left + h * 0.08; x < right; x += h * 0.14) {
        ctx.fillRect(x, top - h * 0.1, h * 0.04, bottom - top + h * 0.2);
    }
    ctx.restore();
    // folded edge
    ctx.fillStyle = "#c8dbff";
    roundRect(ctx, left - h * 0.02, top - h * 0.005, h * 0.07, bottom - top, h * 0.02);
    ctx.fill();
}

// ---------- sheet builder ----------

export interface IPartImage {
    part: IAvatarPart;
    image: Img;
}

// `pixelScale` is how many texture pixels per on-screen pixel (e.g. devicePixelRatio)
export function buildAvatarSheet(
    source: Img,
    options: IAvatarOptions = {},
    pixelScale: number = 1,
    partImages: IPartImage[] = []
): IAvatarSheet {
    // 1. clean up the source and find the character's bounds (body + parts)
    const base = copyOf(source);
    const parts = partImages.map((p) => ({ ...p, canvas: copyOf(p.image) }));
    let bounds: IBox = { x: 0, y: 0, w: base.width, h: base.height };
    try {
        removeFlatBackground(base, options.removeBackground ?? "auto");
        parts.forEach((p) => removeFlatBackground(p.canvas, "auto"));
        const composite = copyOf(base);
        const cctx = context(composite);
        parts.forEach((p) => cctx.drawImage(p.canvas, p.part.x, p.part.y));
        bounds = opaqueBounds(composite) ?? bounds;
    } catch (err) {
        // pixel access can fail for cross-origin images; draw the image as-is
        console.warn("Avatar cleanup skipped:", err);
    }

    // 2. sizes
    let h = Math.round((options.height ?? DEFAULT_HEIGHT) * pixelScale);
    let w = Math.round((h * bounds.w) / bounds.h);
    const maxW = h * 1.6;
    if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = Math.round(maxW);
    }
    const columns = Math.ceil(Math.sqrt(TOTAL_FRAMES));
    const rows = Math.ceil(TOTAL_FRAMES / columns);
    let frameSize = Math.ceil(Math.max(h * 1.32, w + h * 0.45));
    const maxFrame = Math.floor(MAX_TEXTURE_SIZE / Math.max(columns, rows));
    if (frameSize > maxFrame) {
        const k = maxFrame / frameSize;
        h = Math.floor(h * k);
        w = Math.floor(w * k);
        frameSize = maxFrame;
    }
    const k = h / bounds.h; // source px -> sheet px
    const margin = Math.max(1, Math.round(frameSize * 0.01));

    // 3. body in every eye state, cropped and scaled the same way
    const body: { [e in Eyes]: HTMLCanvasElement } = {} as any;
    for (const kind of ["open", "closed", "happy", "sleep", "angry", "sad"] as Eyes[]) {
        let variant = base;
        try {
            variant = eyeVariant(base, options, kind);
        } catch (err) {
            console.warn("Avatar eyes skipped:", err);
        }
        body[kind] = resample(crop(variant, bounds), w, h);
    }

    // parts scaled the same way, positioned in "character space":
    // x from -w/2..w/2, y from -h (top of head) .. 0 (feet)
    const limbs = parts.map((p) => ({
        part: p.part,
        canvas: resample(p.canvas, Math.max(1, p.canvas.width * k), Math.max(1, p.canvas.height * k)),
        pivotX: (p.part.x + p.part.pivotX - bounds.x) * k - w / 2,
        pivotY: (p.part.y + p.part.pivotY - bounds.y) * k - h,
        offX: p.part.pivotX * k,
        offY: p.part.pivotY * k,
    }));

    const drawCharacter = (ctx: CanvasRenderingContext2D, pose: IPose) => {
        const drawLimb = (l: (typeof limbs)[number]) => {
            const lp = pose.limbs?.[l.part.name] ?? {};
            const raise = lp.raise ?? 0;
            // "raise" lifts arms up/outwards; legs on the left kick left, on the right kick right
            const rot = l.part.name.endsWith("L") ? raise : -raise;
            ctx.save();
            ctx.translate(l.pivotX + (lp.dx ?? 0) * h, l.pivotY + (lp.dy ?? 0) * h);
            ctx.rotate(rot);
            ctx.drawImage(l.canvas, -l.offX, -l.offY);
            ctx.restore();
        };
        limbs.filter((l) => l.part.behind).forEach(drawLimb);
        ctx.drawImage(body[pose.eyes ?? "open"], -w / 2, -h, w, h);
        limbs.filter((l) => !l.part.behind).forEach(drawLimb);
    };

    // 4. draw every frame
    const sheet = makeCanvas(columns * frameSize, rows * frameSize);
    const ctx = context(sheet);
    let sleepHead = { x: 0.25, y: 0.6 };
    let index = 0;
    for (const def of AVATAR_STATE_DEFS) {
        for (let i = 0; i < def.frames; i++, index++) {
            const fx = (index % columns) * frameSize;
            const fy = Math.floor(index / columns) * frameSize;
            const p = def.pose(i / def.frames, i, def.frames);
            const cx = fx + frameSize / 2;
            const ground = fy + frameSize - margin;

            ctx.save();
            ctx.beginPath();
            ctx.rect(fx, fy, frameSize, frameSize);
            ctx.clip();

            if (def.anchor === "bed") {
                const bed = bedLayout(cx, ground, h, w);
                drawBedBack(ctx, bed, ground, h);
                ctx.save();
                ctx.translate(bed.pivotX, bed.pivotY);
                ctx.rotate(-Math.PI / 2); // lying down, head to the left
                ctx.scale((p.sx ?? 1) * SLEEP_SCALE, (p.sy ?? 1) * SLEEP_SCALE);
                drawCharacter(ctx, p);
                ctx.restore();
                drawBlanket(ctx, bed, h, w, p.propPhase ?? 0);
                sleepHead = {
                    x: (bed.pivotX - h * SLEEP_SCALE * 0.8 - fx) / frameSize,
                    y: (bed.pivotY - w * SLEEP_SCALE * 0.5 - fy) / frameSize,
                };
                ctx.restore();
                continue;
            }

            // pivot + base rotation per anchor; the character is drawn "standing" on the pivot
            let pivotX = cx;
            let pivotY = ground;
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

            ctx.save();
            ctx.translate(pivotX, pivotY);
            ctx.rotate(baseRot);
            ctx.translate((p.dx ?? 0) * h, (p.dy ?? 0) * h);
            if (def.anchor === "center") {
                // swing around the middle of the body, not the feet
                ctx.translate(0, -h / 2);
                ctx.rotate(p.rot ?? 0);
                ctx.translate(0, h / 2);
            } else {
                ctx.rotate(p.rot ?? 0);
            }
            ctx.scale(p.sx ?? 1, p.sy ?? 1);
            drawCharacter(ctx, p);
            ctx.restore();

            // props in front of the character
            if (p.prop === "laptop") drawLaptop(ctx, cx, ground, h, w, p.propPhase ?? 0);
            if (p.prop === "controller") drawController(ctx, cx, ground, h, w, p.propPhase ?? 0);
            if (p.prop === "popcorn") drawPopcorn(ctx, cx, ground, h, w, p.propPhase ?? 0);

            if (p.tint) {
                ctx.globalCompositeOperation = "source-atop";
                ctx.fillStyle = `rgba(${p.tint})`;
                ctx.fillRect(fx, fy, frameSize, frameSize);
                ctx.globalCompositeOperation = "source-over";
            }

            // light from a screen in front of the character
            if (p.light) {
                const g = ctx.createRadialGradient(cx, ground - h * 0.55, h * 0.05, cx, ground - h * 0.5, h * 0.75);
                g.addColorStop(0, `rgba(${p.light})`);
                g.addColorStop(1, "rgba(0,0,0,0)");
                ctx.globalCompositeOperation = "source-atop";
                ctx.fillStyle = g;
                ctx.fillRect(fx, fy, frameSize, frameSize);
                ctx.globalCompositeOperation = "source-over";
            }

            ctx.restore();
        }
    }

    return {
        canvas: sheet,
        frameSize,
        columns,
        headTopRatio: (frameSize - margin - h) / frameSize,
        sleepHead,
    };
}

// ---------- Phaser glue ----------

export const avatarSourceKey = (name: string) => `${name}__avatar_src`;
export const avatarPartKey = (name: string, index: number) => `${name}__avatar_part_${index}`;

export interface IAvatarMeta {
    headTopRatio: number;
    frameSize: number;
    sleepHead: { x: number; y: number };
}

// per texture key: metadata used by Pets.ts (bubble placement, snoring position)
export const avatarMeta: Map<string, IAvatarMeta> = new Map();

/*
 * Builds the sprite sheet texture `name` from the already loaded images and
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
    const partImages: IPartImage[] = [];
    (options.parts ?? []).forEach((part, i) => {
        const key = avatarPartKey(name, i);
        if (textures.exists(key)) {
            partImages.push({ part, image: textures.get(key).getSourceImage() as HTMLImageElement });
        }
    });
    const sheet = buildAvatarSheet(source, options, 1, partImages);

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

    avatarMeta.set(name, {
        headTopRatio: sheet.headTopRatio,
        frameSize: sheet.frameSize,
        sleepHead: sheet.sleepHead,
    });
    return sheet.frameSize;
}
