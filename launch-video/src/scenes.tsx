import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import frames from "./frames.json";
import { Background, Bubble, Cursor, Floaty, GROUND, headY, Pill, Sprite, Taskbar, Title, Window } from "./components";
import { C, FONT_BODY, FONT_TITLE } from "./theme";

const label = (text: string, x: number, y: number, size = 36, color = C.ink): React.ReactNode => (
    <div style={{ position: "absolute", left: x, top: y, transform: "translateX(-50%)", fontFamily: FONT_TITLE, fontWeight: 800, fontSize: size, color, whiteSpace: "nowrap" }}>
        {text}
    </div>
);

// ---------------------------------------------------------------- 1. intro: drops onto the taskbar
export const Intro: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const fallY = interpolate(frame, [0, 24], [-60, GROUND], { extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
    const t = spring({ frame: frame - 22, fps, config: { damping: 11 } });
    return (
        <AbsoluteFill>
            <Background />
            <div style={{ position: "absolute", top: 170, left: 0, right: 0, textAlign: "center", transform: `scale(${0.6 + 0.4 * t})`, opacity: t }}>
                <div style={{ fontFamily: FONT_TITLE, fontWeight: 800, fontSize: 150, color: C.ink, letterSpacing: -3 }}>WindowPet</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 44, color: C.pink, marginTop: 4 }}>Custom Avatar Edition</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 500, fontSize: 38, color: C.soft, marginTop: 26 }}>
                    A little buddy that lives on your taskbar
                </div>
            </div>
            <Taskbar />
            {frame < 24 && <Sprite state="jump" x={960} y={fallY} />}
            {frame >= 24 && frame < 40 && <Sprite state="fall" x={960} from={24} loop={false} />}
            {frame >= 40 && <Sprite state="greet" x={960} from={40} />}
            <Bubble text="Hi! I'm your new desktop buddy 👋" x={960} y={headY() - 8} at={48} />
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 2. one picture -> hundreds of frames
export const OnePicture: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const card = spring({ frame: frame - 8, fps, config: { damping: 14 } });
    const reveal = interpolate(frame, [36, 110], [100, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
    const total = (frames as any).totalFrames as number;
    const count = Math.round(interpolate(frame, [36, 110], [0, total], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
    const arrow = interpolate(frame, [24, 40], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return (
        <AbsoluteFill>
            <Background />
            <Title title="Made from a single picture" sub="Your image becomes a fully animated character, automatically" top={70} />
            <div style={{ position: "absolute", left: 170, top: 330, width: 360, height: 440, background: "#fff", borderRadius: 28, boxShadow: "0 20px 50px rgba(0,0,0,0.12)", transform: `scale(${card})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Img src={staticFile("avatar.png")} style={{ width: 250 }} />
            </div>
            {label("1 picture", 350, 800, 44)}
            <div style={{ position: "absolute", left: 575, top: 495, fontFamily: FONT_TITLE, fontWeight: 800, fontSize: 110, color: C.pink, opacity: arrow, transform: `translateX(${(1 - arrow) * -30}px)` }}>→</div>
            <div style={{ position: "absolute", left: 760, top: 250, width: 1000, height: 600, background: "#fff", borderRadius: 28, overflow: "hidden", boxShadow: "0 20px 50px rgba(0,0,0,0.12)", opacity: arrow }}>
                <Img src={staticFile("sheet.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", clipPath: `inset(0 ${reveal}% ${reveal}% 0)` }} />
            </div>
            {label(`${count} animation frames`, 1260, 870, 48, C.ink)}
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 3. personality
export const Personality: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const pets: [keyof typeof frames.states, string, string[], string, boolean?][] = [
        ["greet", "Waves hello", ["👋"], C.blue],
        ["dance", "Dances", ["♪", "♫", "♬"], C.pink],
        ["sleep", "Naps in bed", ["z", "Z", "Z"], "#7a6cc9"],
        ["angry", "Gets angry", ["💢", "💨"], "#e8433f"],
        ["sad", "Gets sad", ["💧"], "#5aa9ff", true],
    ];
    return (
        <AbsoluteFill>
            <Background />
            <Title title="Full of personality" sub="Blinks, waves, dances, naps… and has moods" top={70} />
            <Taskbar />
            {pets.map(([state, text, fx, color, fall], k) => {
                const x = 260 + k * 350;
                const s = spring({ frame: frame - 8 - k * 10, fps, config: { damping: 12 } });
                return (
                    <React.Fragment key={state}>
                        <div style={{ opacity: s }}>
                            <Sprite state={state} x={x} from={8 + k * 10} />
                        </div>
                        <div style={{ opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
                            {label(text, x, headY() - 120, 38)}
                        </div>
                        {[0, 1, 2, 3, 4].map((n) => (
                            <Floaty key={n} text={fx[n % fx.length]} x={x + (state === "sleep" ? -60 : 0)} y={fall ? headY() + 120 : headY() + 20}
                                at={30 + k * 10 + n * 28} color={color} fall={fall} />
                        ))}
                    </React.Fragment>
                );
            })}
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 4. knows what you're doing
const CODE = [
    ["#c678dd", "public class", "#e5c07b", " Main {"],
    ["#c678dd", "  public static void", "#61afef", " main(String[] args) {"],
    ["#abb2bf", "    var pet = ", "#61afef", "new WindowPet();"],
    ["#abb2bf", "    pet.", "#61afef", "codeWithMe();"],
    ["#5c6370", "    // it really does sit here with its laptop", "#5c6370", ""],
    ["#abb2bf", "    pet.", "#61afef", "dance(\"lofi beats\");"],
    ["#abb2bf", "  }", "#abb2bf", ""],
    ["#abb2bf", "}", "#abb2bf", ""],
];

export const Aware: React.FC = () => {
    const frame = useCurrentFrame();
    const phase = frame < 70 ? 0 : frame < 140 ? 1 : 2;
    const local = frame - phase * 70;
    const typed = Math.floor(local * 1.6);
    return (
        <AbsoluteFill>
            <Background from="#EEF2FF" to="#FFF1E8" />
            {phase === 0 && (
                <Window title="Main.java — IntelliJ IDEA" x={110} y={120} w={1160} h={780} dark>
                    <div style={{ padding: 36, fontFamily: "monospace", fontSize: 30, lineHeight: 1.7 }}>
                        {CODE.map(([c1, t1, c2, t2], k) => {
                            const line = t1 + t2;
                            const shown = Math.max(0, Math.min(line.length, typed - k * 8));
                            return (
                                <div key={k} style={{ whiteSpace: "pre", minHeight: 50 }}>
                                    <span style={{ color: c1 }}>{line.slice(0, Math.min(shown, t1.length))}</span>
                                    <span style={{ color: c2 }}>{line.slice(t1.length, shown)}</span>
                                </div>
                            );
                        })}
                    </div>
                </Window>
            )}
            {phase === 1 && (
                <Window title="Movie night — YouTube — Google Chrome" x={110} y={120} w={1160} h={780}>
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg,#2a1b3d,#44318d 50%,#e98074)" }} />
                    <div style={{ position: "absolute", left: "50%", top: "45%", transform: "translate(-50%,-50%)", width: 150, height: 104, background: "#ff0033", borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 0, height: 0, borderLeft: "44px solid white", borderTop: "26px solid transparent", borderBottom: "26px solid transparent", marginLeft: 10 }} />
                    </div>
                    <div style={{ position: "absolute", left: 30, right: 30, bottom: 30, height: 8, background: "rgba(255,255,255,0.3)", borderRadius: 4 }}>
                        <div style={{ width: `${20 + local * 0.8}%`, height: "100%", background: "#ff0033", borderRadius: 4 }} />
                    </div>
                </Window>
            )}
            {phase === 2 && (
                <Window title="Spotify" x={110} y={120} w={1160} h={780} dark>
                    <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,#1e3a2b,#121212 70%)" }} />
                    <div style={{ position: "absolute", left: 70, top: 90, width: 300, height: 300, borderRadius: 16, background: "linear-gradient(135deg,#ffb02e,#ff6b9a)", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }} />
                    <div style={{ position: "absolute", left: 420, top: 190, fontFamily: FONT_TITLE, fontWeight: 800, fontSize: 72, color: "#fff" }}>Lofi Beats</div>
                    <div style={{ position: "absolute", left: 424, top: 290, fontFamily: FONT_BODY, fontSize: 32, color: "#b3b3b3" }}>Chill playlist</div>
                    <div style={{ position: "absolute", left: 70, bottom: 120, display: "flex", gap: 10, alignItems: "flex-end", height: 160 }}>
                        {Array.from({ length: 28 }).map((_, k) => (
                            <div key={k} style={{ width: 22, borderRadius: 4, background: "#1db954", height: 30 + 120 * Math.abs(Math.sin(local * 0.25 + k * 0.7)) }} />
                        ))}
                    </div>
                </Window>
            )}
            <Taskbar />
            {label(["Codes with you", "Watches with you", "Dances to your music"][phase], 1590, 170, 54)}
            {phase === 0 && <Sprite state="laptop" x={1590} from={0} />}
            {phase === 1 && <Sprite state="movie" x={1590} from={70} />}
            {phase === 2 && <Sprite state="dance" x={1590} from={140} />}
            {phase === 0 && <Bubble text={"Working in IntelliJ\ntogether! 💻"} x={1590} y={headY() - 8} at={10} until={64} />}
            {phase === 1 && <Bubble text={"Ooh, what are we\nwatching? 🍿"} x={1590} y={headY() - 8} at={78} until={134} />}
            {phase === 2 && <Bubble text={"🎶 Banger!\n♪ Lofi Beats"} x={1590} y={headY() - 8} at={148} />}
            {phase === 2 && [0, 1, 2, 3, 4, 5].map((n) => (
                <Floaty key={n} text={["♪", "♫", "♬"][n % 3]} x={1500 + (n % 3) * 90} y={headY() + 60} at={150 + n * 9} color={[C.pink, C.blue, C.yellow][n % 3]} />
            ))}
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 5. pet it, feed it
export const Comfort: React.FC = () => {
    const frame = useCurrentFrame();
    const x = 960;
    const hearts = frame < 50 ? 0 : frame < 72 ? 1 : frame < 128 ? 2 : 4;
    const cookieY = interpolate(frame, [95, 118], [260, headY() + 150], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.in(Easing.quad) });
    const rubbing = frame >= 28 && frame < 92;
    return (
        <AbsoluteFill>
            <Background from="#FFF0F0" to="#FFF6E5" />
            <Title title="Upset? Pet it. Feed it." sub="Rub the cursor over it, or drop it a snack 🍪" top={70} />
            <Taskbar />
            {frame < 118 && <Sprite state="angry" x={x} />}
            {frame >= 118 && frame < 158 && <Sprite state="eat" x={x} from={118} loop={false} />}
            {frame >= 158 && <Sprite state="happy" x={x} from={158} />}
            {frame < 150 && <Pill text={`💢 ${"❤️".repeat(hearts)}${"🤍".repeat(4 - hearts)}`} x={x} y={headY() - 6} />}
            <Bubble text="Grr… I'm angry! 😤" x={x} y={headY() - 64} at={4} until={44} />
            <Bubble text="Hmph… a little better" x={x} y={headY() - 64} at={76} until={112} />
            <Bubble text="Fine, you're forgiven 😌💕" x={x} y={headY() - 8} at={160} />
            {rubbing && <Cursor x={x - 10 + Math.sin((frame - 28) * 0.45) * 90} y={GROUND - 170} />}
            {[44, 56, 68, 82].map((at, k) => (
                <Floaty key={at} text={k % 2 ? "❤️" : "💕"} x={x + (k % 2 ? 60 : -50)} y={headY() + 40} at={at} />
            ))}
            {frame >= 95 && frame < 118 && (
                <div style={{ position: "absolute", left: x + 70, top: cookieY, fontSize: 70, transform: `translate(-50%,-50%) rotate(${frame * 8}deg)` }}>🍪</div>
            )}
            {[158, 164, 170, 176, 182].map((at, k) => (
                <Floaty key={at} text={["💖", "✨", "💕"][k % 3]} x={x - 100 + k * 50} y={headY() + 40} at={at} />
            ))}
            {frame >= 30 && frame < 92 && <div style={{ position: "absolute", left: 1150, top: 800, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 34, color: C.soft }}>← petting (+1 ❤️)</div>}
            {frame >= 96 && frame < 150 && <div style={{ position: "absolute", left: 1150, top: 800, fontFamily: FONT_BODY, fontWeight: 600, fontSize: 34, color: C.soft }}>← snack (+2 ❤️)</div>}
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 6. wardrobe
export const Wardrobe: React.FC = () => {
    const frame = useCurrentFrame();
    const outfits: [string, number, string][] = [
        ["base", 0, ""],
        ["party", 22, "Yayy! A party hat! 🥳"],
        ["cool", 54, "Ooh, a crown 👑"],
        ["cozy", 86, "Cosy beanie + headphones 🎧"],
        ["sporty", 118, "A new t-shirt! 👕"],
    ];
    const current = [...outfits].reverse().find(([, at]) => frame >= at)!;
    const [variant, at] = current;
    const spinning = at > 0 && frame - at < 18;
    return (
        <AbsoluteFill>
            <Background from="#F3ECFF" to="#FFF6E5" />
            <Title title="Dress it up" sub="Hats, glasses, headphones and t-shirts — it loves new clothes" top={70} />
            <Taskbar />
            <Sprite state={spinning ? "spin" : "greet"} variant={variant} x={960} from={at} scale={1.15} />
            {outfits.slice(1).map(([, oat, text], k) => (
                <React.Fragment key={k}>
                    <Bubble text={text} x={960} y={headY(GROUND, 1.15) - 8} at={oat + 4} until={(outfits[k + 2]?.[1] ?? 160) - 6} />
                    {[0, 1, 2].map((n) => (
                        <Floaty key={n} text={["✨", "⭐", "💖"][n]} x={880 + n * 80} y={headY(GROUND, 1.15) + 60} at={oat + n * 3} color={C.yellow} />
                    ))}
                </React.Fragment>
            ))}
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 7. useful
export const Useful: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const left = Math.max(0, 1500 - frame * 9);
    const timer = `🍅 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    const items: [number, string][] = [[400, "Focus timer"], [960, "Wellbeing nudges"], [1520, "Reminders"]];
    return (
        <AbsoluteFill>
            <Background />
            <Title title="Actually useful" sub="Focus sessions, healthy nudges and reminders — from your pet" top={70} />
            <Taskbar />
            {items.map(([x, text], k) => {
                const s = spring({ frame: frame - 6 - k * 10, fps, config: { damping: 14 } });
                return <div key={k} style={{ opacity: s }}>{label(text, x, 330, 46, C.pink)}</div>;
            })}
            <Sprite state="laptop" x={400} />
            <Pill text={timer} x={400} y={headY() - 6} at={10} />
            <Sprite state="greet" x={960} from={20} />
            <Bubble text="Time for some water 💧" x={960} y={headY() - 8} at={24} />
            <Sprite state="attention" x={1520} from={40} />
            <Bubble text={"⏰ Stand-up meeting\n(click me when done)"} x={1520} y={headY() - 30} at={44} />
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------- 8. end card
export const Outro: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const t = spring({ frame: frame - 4, fps, config: { damping: 13 } });
    const t2 = spring({ frame: frame - 22, fps, config: { damping: 13 } });
    return (
        <AbsoluteFill>
            <Background from="#FFF6E5" to="#FFE3EC" />
            <div style={{ position: "absolute", top: 120, left: 0, right: 0, textAlign: "center", opacity: t, transform: `scale(${0.8 + 0.2 * t})` }}>
                <div style={{ fontFamily: FONT_TITLE, fontWeight: 800, fontSize: 140, color: C.ink, letterSpacing: -3 }}>WindowPet</div>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 44, color: C.pink }}>Custom Avatar Edition</div>
            </div>
            <div style={{ position: "absolute", top: 430, left: 0, right: 0, textAlign: "center", opacity: t2, transform: `translateY(${(1 - t2) * 20}px)` }}>
                <div style={{ fontFamily: FONT_BODY, fontWeight: 600, fontSize: 40, color: C.soft }}>Free for Windows 10 & 11</div>
                <div style={{ display: "inline-block", marginTop: 26, padding: "18px 40px", borderRadius: 999, background: C.ink, color: "#fff", fontFamily: FONT_BODY, fontWeight: 600, fontSize: 40 }}>
                    github.com/Dm-1324/WindowPet
                </div>
            </div>
            <Taskbar />
            <Sprite state="greet" x={960} from={10} />
            <Bubble text="See you on your taskbar! 👋" x={960} y={headY() - 8} at={30} />
            <div style={{ position: "absolute", bottom: 90, right: 40, fontFamily: FONT_BODY, fontSize: 22, color: C.soft }}>
                Built on WindowPet by SeakMengs · MIT
            </div>
        </AbsoluteFill>
    );
};
