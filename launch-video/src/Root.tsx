import React from "react";
import { Composition } from "remotion";
import { TOTAL, WindowPetLaunch } from "./Video";

export const Root: React.FC = () => (
    <Composition id="WindowPetLaunch" component={WindowPetLaunch} durationInFrames={TOTAL} fps={30} width={1920} height={1080} />
);
