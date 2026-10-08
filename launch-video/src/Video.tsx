import React from "react";
import { AbsoluteFill, Html5Audio, interpolate, Sequence, Series, staticFile } from "remotion";
import "./theme"; // loads the fonts
import { Fade } from "./components";
import { Aware, Comfort, Intro, OnePicture, Outro, Personality, Useful, Wardrobe } from "./scenes";

// scene lengths in frames (30 fps)
export const SCENES: [React.FC, number][] = [
    [Intro, 150],
    [OnePicture, 150],
    [Personality, 180],
    [Aware, 210],
    [Comfort, 210],
    [Wardrobe, 150],
    [Useful, 150],
    [Outro, 150],
];

export const TOTAL = SCENES.reduce((n, [, d]) => n + d, 0);

// scene start frames, to place sound effects
const START = SCENES.reduce<number[]>((acc, [, d], k) => [...acc, k === 0 ? 0 : acc[k - 1] + SCENES[k - 1][1]], []);
const [INTRO, ONE, PERSONALITY, AWARE, COMFORT, WARDROBE, USEFUL, OUTRO] = START;

// [effect, frame, volume] (effects are made by scripts/make-audio.py)
const SFX: [string, number, number][] = [
    ["whoosh", INTRO + 18, 0.5], ["boing", INTRO + 24, 0.7], ["pop", INTRO + 48, 0.6],
    ["whoosh", ONE + 34, 0.5], ["sparkle", ONE + 108, 0.6],
    ...[0, 1, 2, 3, 4].map((k): [string, number, number] => ["pop", PERSONALITY + 8 + k * 10, 0.45]),
    ["pop", AWARE + 10, 0.55], ["whoosh", AWARE + 68, 0.45], ["pop", AWARE + 78, 0.55], ["whoosh", AWARE + 138, 0.45], ["pop", AWARE + 148, 0.55],
    ["pop", COMFORT + 4, 0.55], ...[44, 56, 68, 82].map((f): [string, number, number] => ["pop", COMFORT + f, 0.3]),
    ["pop", COMFORT + 76, 0.5], ["whoosh", COMFORT + 94, 0.4], ["munch", COMFORT + 120, 0.8], ["munch", COMFORT + 136, 0.7],
    ["sparkle", COMFORT + 158, 0.65], ["pop", COMFORT + 160, 0.5],
    ...[22, 54, 86, 118].map((f): [string, number, number] => ["sparkle", WARDROBE + f, 0.55]),
    ["pop", USEFUL + 24, 0.55], ["ding", USEFUL + 44, 0.6],
    ["sparkle", OUTRO + 4, 0.5], ["pop", OUTRO + 30, 0.55],
];

export const WindowPetLaunch: React.FC = () => (
    <AbsoluteFill style={{ background: "#FFF6E5" }}>
        {/* original background music; quieter under the busiest scenes */}
        <Html5Audio
            src={staticFile("audio/music.wav")}
            volume={(f) => interpolate(f, [0, COMFORT, COMFORT + 20, WARDROBE, WARDROBE + 20], [0.75, 0.75, 0.6, 0.6, 0.75], { extrapolateRight: "clamp" })}
        />
        {SFX.map(([name, frame, volume], k) => (
            <Sequence key={k} from={frame} durationInFrames={45}>
                <Html5Audio src={staticFile(`audio/${name}.wav`)} volume={volume} />
            </Sequence>
        ))}
        <Series>
            {SCENES.map(([Scene, duration], k) => (
                <Series.Sequence key={k} durationInFrames={duration}>
                    <Fade duration={duration}>
                        <Scene />
                    </Fade>
                </Series.Sequence>
            ))}
        </Series>
    </AbsoluteFill>
);
