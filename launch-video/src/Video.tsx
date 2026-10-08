import React from "react";
import { AbsoluteFill, Series } from "remotion";
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

export const WindowPetLaunch: React.FC = () => (
    <AbsoluteFill style={{ background: "#FFF6E5" }}>
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
