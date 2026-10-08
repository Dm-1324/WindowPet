import { continueRender, delayRender, staticFile } from "remotion";

export const C = {
    cream: "#FFF6E5",
    sky: "#E6EEFF",
    ink: "#2B2233",
    soft: "#6B5E66",
    pink: "#FF6B9A",
    yellow: "#FFC93C",
    blue: "#4F8EF7",
    bubble: "#FFF6E5",
    bubbleLine: "#5B4636",
};

export const FONT_TITLE = "'Inter Display', 'Inter', sans-serif";
export const FONT_BODY = "'Inter', sans-serif";

// load the bundled fonts before any frame is rendered
const fonts: [string, string, string][] = [
    ["Inter Display", "fonts/InterDisplay-ExtraBold.otf", "800"],
    ["Inter", "fonts/Inter-SemiBold.otf", "600"],
    ["Inter", "fonts/Inter-Medium.otf", "500"],
];
if (typeof window !== "undefined" && "FontFace" in window) {
    const handle = delayRender("Loading fonts");
    Promise.all(
        fonts.map(([family, file, weight]) =>
            new FontFace(family, `url(${staticFile(file)})`, { weight }).load().then((f) => document.fonts.add(f))
        )
    )
        .then(() => continueRender(handle))
        .catch(() => continueRender(handle));
}
