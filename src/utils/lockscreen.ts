/*
 * Lock screen picture: Windows doesn't let apps draw on the lock screen itself,
 * so we render a picture of the pet with a speech bubble and set it as the
 * lock screen image (Settings → Personalisation → Lock screen).
 */
import { invoke } from "@tauri-apps/api/tauri";
import { createDir, removeFile, writeBinaryFile } from "@tauri-apps/api/fs";
import { join, pictureDir } from "@tauri-apps/api/path";
import defaultPetConfig from "../config/pet_config";
import { IPartImage, renderAvatarStill } from "../scenes/avatar";
import { effectiveWardrobe, loadCompanion, loadWeather, weatherKind } from "./companion";

interface IScene {
    state: string;
    frame: number;
    lines: string[];
}

const DAY: IScene[] = [
    {
        state: "greet", frame: 10, lines: [
            "Laptop's locked 🔒\nUnlock to chat with me!",
            "Psst… it's me! 👋\nUnlock and say hi",
            "Waiting right here for you 💖\nUnlock to continue",
        ],
    },
    {
        state: "attention", frame: 4, lines: [
            "Shh… I'm guarding your laptop 🛡️\nUnlock to play!",
            "No peeking! 🙈\nOnly my human can unlock this",
            "Hey! Over here! 👀\nUnlock to hang out",
        ],
    },
    {
        state: "sit", frame: 0, lines: [
            "I saved you some snacks 🍪\n…unlock to share!",
            "Just sitting here, guarding 🛡️\nUnlock when you're back",
        ],
    },
];

const NIGHT: IScene = {
    state: "sleep", frame: 4, lines: [
        "Zzz… 💤\nUnlock to wake me up",
        "Sleeping on guard duty 😴🛡️\nUnlock to wake me",
        "Shh… it's late 🌙\nUnlock if you need me",
    ],
};

function timeLine(): string | null {
    const h = new Date().getHours();
    if (h >= 5 && h < 11) return "Good morning! ☀️\nUnlock and let's start the day";
    if (h >= 18 && h < 22) return "Good evening! 🌙\nUnlock to hang out";
    return null;
}

function weatherLine(): string | null {
    const w = loadCompanion().weather ? loadWeather() : null;
    if (!w) return null;
    switch (weatherKind(w)) {
        case "rain":
        case "storm":
            return `Rainy in ${w.place} ☔\nUnlock and stay cosy with me`;
        case "snow":
        case "cold":
            return `Brr, ${Math.round(w.temperature)}° outside 🥶\nUnlock and warm up with me`;
        case "hot":
        case "sunny":
            return `Sunny in ${w.place} 😎\nUnlock to say hi!`;
        default:
            return null;
    }
}

const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function loadImage(src: string): Promise<HTMLImageElement> {
    // bundled pet images are served from the app root ("media/…")
    if (!/^(https?:|asset:|data:|\/)/.test(src)) src = "/" + src;
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`couldn't load ${src}`));
        img.src = src;
    });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export interface ILockScreenPicture {
    canvas: HTMLCanvasElement;
    line: string;
}

// draws the picture at the screen's real resolution
export async function renderLockScreen(): Promise<ILockScreenPicture> {
    const avatar = defaultPetConfig.find((p) => p.avatar);
    if (!avatar?.avatar) throw new Error("no avatar pet found");
    const options = { ...avatar.avatar, wardrobe: effectiveWardrobe() };

    const source = await loadImage(avatar.imageSrc);
    const parts: IPartImage[] = [];
    for (const part of options.parts ?? []) parts.push({ part, image: await loadImage(part.src) });

    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(window.screen.width * dpr);
    const H = Math.round(window.screen.height * dpr);
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // scene + line
    const hour = new Date().getHours();
    const night = hour >= 22 || hour < 6;
    const scene = night ? NIGHT : pick(DAY);
    const special = night ? null : Math.random() < 0.5 ? weatherLine() ?? timeLine() : timeLine();
    const line = special && Math.random() < 0.6 ? special : pick(scene.lines);

    // background: the app's warm cream → sky gradient (darker at night)
    const g = ctx.createLinearGradient(0, 0, W, H);
    if (night) {
        g.addColorStop(0, "#2b2552");
        g.addColorStop(1, "#4a3f7a");
    } else {
        g.addColorStop(0, "#FFF6E5");
        g.addColorStop(1, "#E6EEFF");
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft confetti dots / stars
    for (let k = 0; k < 70; k++) {
        const x = (Math.sin(k * 91.7) * 0.5 + 0.5) * W;
        const y = (Math.sin(k * 37.3 + 1) * 0.5 + 0.5) * H;
        ctx.fillStyle = night
            ? `rgba(255,255,220,${0.25 + (k % 3) * 0.15})`
            : ["rgba(255,107,154,0.18)", "rgba(79,142,247,0.16)", "rgba(255,201,60,0.22)"][k % 3];
        ctx.beginPath();
        ctx.arc(x, y, (night ? 1.5 : 4 + (k % 4) * 2) * dpr, 0, Math.PI * 2);
        ctx.fill();
    }

    // the pet, lower right (clear of the Windows 10/11 clocks)
    const petHeight = Math.round(H * (scene.state === "sleep" ? 0.28 : 0.3));
    const still = renderAvatarStill(source, options, parts, scene.state, scene.frame, petHeight);
    const F = still.canvas.width;
    const cx = W * 0.74;
    const ground = H * 0.88;
    ctx.fillStyle = night ? "rgba(0,0,0,0.25)" : "rgba(91,70,54,0.12)";
    ctx.beginPath();
    ctx.ellipse(cx, ground - F * 0.01, F * 0.42, F * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(still.canvas, cx - F / 2, ground - F);

    // where the head is, for the bubble's tail
    const head =
        scene.state === "sleep"
            ? { x: cx - F / 2 + still.sleepHead.x * F, y: ground - F + still.sleepHead.y * F }
            : { x: cx, y: ground - F + still.headTopRatio * F };

    // speech bubble up and to the left of the head
    const fontSize = Math.round(H * 0.034);
    ctx.font = `bold ${fontSize}px "Segoe UI Emoji", "Segoe UI", sans-serif`;
    const rows = line.split("\n");
    const textW = Math.max(...rows.map((r) => ctx.measureText(r).width));
    const padX = fontSize * 0.9, padY = fontSize * 0.6, lineH = fontSize * 1.3;
    const bw = textW + padX * 2, bh = rows.length * lineH + padY * 2;
    const bx = Math.min(head.x - bw * 0.75, W - bw - W * 0.03);
    const by = head.y - bh - fontSize * 1.6;
    const radius = fontSize * 0.9;

    ctx.fillStyle = "rgba(0,0,0,0.12)";
    roundRect(ctx, bx + 4 * dpr, by + 6 * dpr, bw, bh, radius);
    ctx.fill();
    ctx.fillStyle = "#FFF6E5";
    ctx.strokeStyle = "#5B4636";
    ctx.lineWidth = Math.max(3, fontSize * 0.1);
    roundRect(ctx, bx, by, bw, bh, radius);
    ctx.fill();
    ctx.stroke();
    // tail pointing down-right at the head
    const tx = Math.min(Math.max(head.x - fontSize * 0.4, bx + radius * 1.5), bx + bw - radius * 1.5);
    ctx.beginPath();
    ctx.moveTo(tx - fontSize * 0.55, by + bh - ctx.lineWidth / 2);
    ctx.lineTo(head.x + fontSize * 0.2, head.y - fontSize * 0.25);
    ctx.lineTo(tx + fontSize * 0.55, by + bh - ctx.lineWidth / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(tx - fontSize * 0.5, by + bh - ctx.lineWidth * 1.5, fontSize, ctx.lineWidth * 1.4);

    ctx.fillStyle = "#4A3B33";
    ctx.textBaseline = "middle";
    rows.forEach((r, k) => {
        ctx.fillText(r, bx + padX, by + padY + lineH * (k + 0.5));
    });

    // small signature
    ctx.font = `600 ${Math.round(H * 0.016)}px "Segoe UI", sans-serif`;
    ctx.fillStyle = night ? "rgba(255,255,255,0.45)" : "rgba(74,59,51,0.4)";
    ctx.textAlign = "right";
    ctx.fillText("WindowPet", W - W * 0.02, H - H * 0.025);

    return { canvas, line };
}

// saves the picture to Pictures\WindowPet and asks Windows to use it on the lock screen
export async function applyLockScreen(picture?: ILockScreenPicture): Promise<{ ok: boolean; message: string; path: string }> {
    const pic = picture ?? (await renderLockScreen());
    const blob: Blob = await new Promise((resolve, reject) =>
        pic.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("couldn't encode the picture"))), "image/png")
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const folder = await join(await pictureDir(), "WindowPet");
    await createDir(folder, { recursive: true }).catch(() => {});
    // alternate between two names: Windows caches lock screen images by path
    let slot = 0;
    try {
        slot = (Number(localStorage.getItem("windowpet.lockSlot")) + 1) % 2;
        localStorage.setItem("windowpet.lockSlot", String(slot));
    } catch {
        // storage unavailable: always slot 0
    }
    const path = await join(folder, `lock-screen-${slot}.png`);
    await removeFile(path).catch(() => {});
    await writeBinaryFile(path, bytes);

    try {
        const message = await invoke<string>("set_lock_screen", { path });
        return { ok: true, message, path };
    } catch (err) {
        return { ok: false, message: String(err), path };
    }
}
