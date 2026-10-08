import React from "react";
import {
    AbsoluteFill,
    Easing,
    Img,
    interpolate,
    spring,
    staticFile,
    useCurrentFrame,
    useVideoConfig,
} from "remotion";
import frames from "./frames.json";
import { C, FONT_BODY, FONT_TITLE } from "./theme";

export const GROUND = 1006; // top of the taskbar = where the pet stands
const FRAME = (frames as any).frameSize as number;
const HEAD = (frames as any).headTopRatio as number;

type StateName = keyof typeof frames.states;

// plays one of the avatar's animations; (x, y) = where its feet touch the ground
export const Sprite: React.FC<{
    state: StateName;
    variant?: string;
    x: number;
    y?: number;
    scale?: number;
    flip?: boolean;
    from?: number; // frame (inside the current sequence) when this animation starts
    loop?: boolean;
    opacity?: number;
}> = ({ state, variant = "base", x, y = GROUND, scale = 1, flip, from = 0, loop = true, opacity = 1 }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = frames.states[state];
    let i = Math.floor((Math.max(0, frame - from) * s.fps) / fps);
    i = loop ? i % s.frames : Math.min(i, s.frames - 1);
    const size = FRAME * scale;
    return (
        <Img
            src={staticFile(`frames/${variant}/${state}/${i}.png`)}
            style={{
                position: "absolute",
                left: x - size / 2,
                top: y - size,
                width: size,
                height: size,
                transform: flip ? "scaleX(-1)" : undefined,
                opacity,
            }}
        />
    );
};

// y of the top of the head for a sprite standing at `y`
export const headY = (y: number = GROUND, scale = 1) => y - FRAME * scale * (1 - HEAD);

export const Background: React.FC<{ from?: string; to?: string }> = ({ from = C.cream, to = C.sky }) => (
    <AbsoluteFill style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }} />
);

// a Windows-like taskbar along the bottom
export const Taskbar: React.FC = () => {
    const icons = ["#4f8ef7", "#f7b84f", "#3ec46d", "#ff6b6b", "#9b6bff", "#2bc0d8"];
    return (
        <div
            style={{
                position: "absolute", left: 0, right: 0, top: GROUND, height: 1080 - GROUND,
                background: "rgba(28,28,36,0.92)", display: "flex", alignItems: "center", justifyContent: "center", gap: 18,
            }}
        >
            {icons.map((c, k) => (
                <div key={k} style={{ width: 40, height: 40, borderRadius: 10, background: c, opacity: 0.9 }} />
            ))}
            <div style={{ position: "absolute", right: 40, color: "#fff", fontFamily: FONT_BODY, fontSize: 22, opacity: 0.85 }}>
                17:19
            </div>
        </div>
    );
};

const pop = (frame: number, fps: number, at: number) =>
    spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 180, mass: 0.6 } });

// the app's speech bubble: cream, outlined, with a tail pointing down at (x, y)
export const Bubble: React.FC<{ text: string; x: number; y: number; at?: number; until?: number; size?: number }> = ({
    text, x, y, at = 0, until = Infinity, size = 30,
}) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    if (frame < at || frame > until + 8) return null;
    const s = pop(frame, fps, at);
    const out = frame > until ? interpolate(frame, [until, until + 8], [1, 0], { extrapolateRight: "clamp" }) : 1;
    return (
        <div
            style={{
                position: "absolute", left: x, top: y, transform: `translate(-50%, -100%) scale(${0.3 + 0.7 * s})`,
                transformOrigin: "50% 100%", opacity: Math.min(1, s * 1.5) * out,
            }}
        >
            <div
                style={{
                    background: C.bubble, border: `3px solid ${C.bubbleLine}`, borderRadius: 22, padding: "12px 24px",
                    fontFamily: FONT_BODY, fontWeight: 600, fontSize: size, color: C.ink, whiteSpace: "pre", textAlign: "center",
                    boxShadow: "0 6px 0 rgba(0,0,0,0.10)",
                }}
            >
                {text}
            </div>
            <svg width="34" height="20" style={{ display: "block", margin: "-3px auto 0" }}>
                <path d="M2 0 L17 18 L32 0" fill={C.bubble} stroke={C.bubbleLine} strokeWidth="3" />
                <rect x="4" y="0" width="26" height="3" fill={C.bubble} />
            </svg>
        </div>
    );
};

// the dark pill used for the mood hearts and the focus timer
export const Pill: React.FC<{ text: string; x: number; y: number; at?: number }> = ({ text, x, y, at = 0 }) => {
    const frame = useCurrentFrame();
    if (frame < at) return null;
    return (
        <div
            style={{
                position: "absolute", left: x, top: y, transform: "translate(-50%, -100%)",
                background: "rgba(59,47,47,0.9)", color: "#fff", borderRadius: 999, padding: "6px 18px",
                fontFamily: FONT_BODY, fontWeight: 600, fontSize: 26, whiteSpace: "pre",
            }}
        >
            {text}
        </div>
    );
};

// an emoji / symbol floating up (or falling, for tears) and fading out
export const Floaty: React.FC<{ text: string; x: number; y: number; at: number; color?: string; size?: number; fall?: boolean }> = ({
    text, x, y, at, color = C.pink, size = 40, fall,
}) => {
    const frame = useCurrentFrame();
    const t = frame - at;
    if (t < 0 || t > 50) return null;
    const p = t / 50;
    return (
        <div
            style={{
                position: "absolute", left: x + Math.sin(p * 6) * 12, top: y + (fall ? 50 : -90) * Easing.out(Easing.quad)(p),
                transform: `translate(-50%, -50%) rotate(${(p - 0.5) * 20}deg)`,
                opacity: interpolate(p, [0, 0.15, 0.7, 1], [0, 1, 1, 0]),
                fontFamily: FONT_TITLE, fontSize: size, color, WebkitTextStroke: "1px white", fontWeight: 800,
            }}
        >
            {text}
        </div>
    );
};

// big scene title + small subtitle, sliding in
export const Title: React.FC<{ title: string; sub?: string; at?: number; top?: number }> = ({ title, sub, at = 0, top = 90 }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const s = spring({ frame: frame - at, fps, config: { damping: 16 } });
    return (
        <div style={{ position: "absolute", top, left: 0, right: 0, textAlign: "center", opacity: s, transform: `translateY(${(1 - s) * 30}px)` }}>
            <div style={{ fontFamily: FONT_TITLE, fontWeight: 800, fontSize: 84, color: C.ink, letterSpacing: -1 }}>{title}</div>
            {sub && <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 36, color: C.soft, marginTop: 8 }}>{sub}</div>}
        </div>
    );
};

// mouse pointer
export const Cursor: React.FC<{ x: number; y: number }> = ({ x, y }) => (
    <svg width="44" height="56" viewBox="0 0 22 28" style={{ position: "absolute", left: x, top: y, filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.3))" }}>
        <path d="M1 1 L1 22 L7 16 L11 26 L15 24 L11 15 L19 15 Z" fill="#fff" stroke="#111" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
);

// a desktop app window
export const Window: React.FC<{ title: string; x: number; y: number; w: number; h: number; dark?: boolean; children?: React.ReactNode }> = ({
    title, x, y, w, h, dark, children,
}) => (
    <div
        style={{
            position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 14, overflow: "hidden",
            background: dark ? "#1f2229" : "#ffffff", boxShadow: "0 30px 60px rgba(0,0,0,0.25)", border: "1px solid rgba(0,0,0,0.15)",
        }}
    >
        <div
            style={{
                height: 46, background: dark ? "#2b2f38" : "#eef0f4", display: "flex", alignItems: "center", padding: "0 18px",
                fontFamily: FONT_BODY, fontSize: 20, color: dark ? "#c9ced8" : "#444",
            }}
        >
            {title}
            <span style={{ marginLeft: "auto", letterSpacing: 14, opacity: 0.7 }}>─ ☐ ✕</span>
        </div>
        <div style={{ position: "relative", height: h - 46 }}>{children}</div>
    </div>
);

// fade a whole scene in and out
export const Fade: React.FC<{ duration: number; children: React.ReactNode }> = ({ duration, children }) => {
    const frame = useCurrentFrame();
    const o = interpolate(frame, [0, 10, duration - 10, duration], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};
