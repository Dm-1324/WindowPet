/*
 * Exports the WindowPet avatar's animation frames as PNGs for the launch video.
 * Uses the real frame generator from ../src/scenes/avatar.ts, at high resolution.
 *   npm run export-frames
 */
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { createCanvas, loadImage } = require("canvas");

const ROOT = path.resolve(__dirname, "../..");
const OUT = path.resolve(__dirname, "../public");
const HEIGHT = 260; // character height in the video (px)

// compile the generator; lift its texture-size cap (that's a GPU limit, not needed here)
const bundle = esbuild.buildSync({
    entryPoints: [path.join(ROOT, "src/scenes/avatar.ts")],
    bundle: true, format: "cjs", platform: "node", write: false,
}).outputFiles[0].text.replace(/MAX_TEXTURE_SIZE = 4096/, "MAX_TEXTURE_SIZE = 16000");
const mod = { exports: {} };
new Function("module", "exports", "require", bundle)(mod, mod.exports, require);
const A = mod.exports;
global.document = { createElement: () => createCanvas(1, 1) };

const VARIANTS = {
    base: { wardrobe: {}, states: null }, // all states
    party: { wardrobe: { hat: "party", shirt: "#1e88e5", shirtPattern: "stripes" }, states: ["stand", "greet", "spin", "dance"] },
    cool: { wardrobe: { hat: "crown", glasses: "sunglasses" }, states: ["stand", "greet", "spin", "dance"] },
    cozy: { wardrobe: { hat: "beanie", headphones: true, shirt: "#8e24aa", shirtPattern: "heart" }, states: ["stand", "greet", "spin", "dance"] },
    sporty: { wardrobe: { hat: "cap", glasses: "hearts", shirt: "#43a047", shirtPattern: "star" }, states: ["stand", "greet", "spin", "dance"] },
};

(async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "src/config/my_avatar.json"), "utf8")).avatar;
    const img = await loadImage(path.join(ROOT, "public", "media/my_avatar.png"));
    const parts = [];
    for (const p of cfg.parts ?? []) parts.push({ part: p, image: await loadImage(path.join(ROOT, "public", p.src)) });
    fs.copyFileSync(path.join(ROOT, "public/media/my_avatar.png"), path.join(OUT, "avatar.png"));

    const manifest = { states: {}, variants: Object.keys(VARIANTS) };
    for (const [name, v] of Object.entries(VARIANTS)) {
        const sheet = A.buildAvatarSheet(img, { ...cfg, height: HEIGHT, wardrobe: v.wardrobe }, 1, parts);
        const F = sheet.frameSize;
        manifest.frameSize = F;
        manifest.headTopRatio = sheet.headTopRatio;
        for (const def of A.AVATAR_STATE_DEFS) {
            if (v.states && !v.states.includes(def.state)) continue;
            const dir = path.join(OUT, "frames", name, def.state);
            fs.mkdirSync(dir, { recursive: true });
            const start = A.AVATAR_STATES[def.state].start - 1;
            for (let i = 0; i < def.frames; i++) {
                const idx = start + i;
                const c = createCanvas(F, F);
                c.getContext("2d").drawImage(sheet.canvas, (idx % sheet.columns) * F, Math.floor(idx / sheet.columns) * F, F, F, 0, 0, F, F);
                fs.writeFileSync(path.join(dir, `${i}.png`), c.toBuffer("image/png"));
            }
            manifest.states[def.state] = { frames: def.frames, fps: def.frameRate };
        }
        // the whole sheet, small, for the "one picture -> hundreds of frames" shot
        if (name === "base") {
            const s = createCanvas(Math.round(sheet.canvas.width / 4), Math.round(sheet.canvas.height / 4));
            const sx = s.getContext("2d");
            sx.imageSmoothingQuality = "high";
            sx.drawImage(sheet.canvas, 0, 0, s.width, s.height);
            fs.writeFileSync(path.join(OUT, "sheet.png"), s.toBuffer("image/png"));
            manifest.totalFrames = A.AVATAR_STATE_DEFS.reduce((n, d) => n + d.frames, 0);
        }
        console.log(`${name}: frame ${F}px`);
    }
    fs.writeFileSync(path.join(__dirname, "../src/frames.json"), JSON.stringify(manifest, null, 2));
})();
