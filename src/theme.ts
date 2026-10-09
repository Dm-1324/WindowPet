import { createTheme, CSSVariablesResolver, MantineColorsTuple } from "@mantine/core";
import "@fontsource-variable/fredoka";
import "@fontsource-variable/nunito";

/*
 * The Settings app takes its colours from the avatar itself:
 *   plum ink   #3C2846  (its outline)       -> text, dark mode surfaces
 *   leaf green #5DAE5B  (the sprout)        -> actions, switches, links
 *   sunny      #FFD66E  (its body)          -> the selected tab
 *   blush      #FF8C96  (its cheeks)        -> small warm touches
 */

// leaf green, light -> dark
const leaf: MantineColorsTuple = [
    "#eef8ec", "#dcf0d8", "#b9e0b2", "#93cf89", "#74c168",
    "#5fb853", "#53ae47", "#449839", "#3a8731", "#2d7426",
];

// sunny yellow (selected tab, highlights)
const sunny: MantineColorsTuple = [
    "#fff9e5", "#fff1c9", "#ffe39a", "#ffd66e", "#ffcb45",
    "#ffc32b", "#f4b51c", "#d99d10", "#c18a06", "#a77500",
];

// blush pink
const blush: MantineColorsTuple = [
    "#ffeef0", "#ffdbe0", "#ffb6bf", "#ff8c96", "#ff6d7a",
    "#ff5868", "#ff4b5d", "#e33c4e", "#cb3244", "#b22539",
];

// Mantine's "dark" scale, re-tinted plum: [0] text … [7] page background
const plum: MantineColorsTuple = [
    "#ece4f2", "#d5c9de", "#ac9cbb", "#82709a", "#55456a",
    "#433456", "#342843", "#271e33", "#1f1729", "#170f1f",
];

export const theme = createTheme({
    primaryColor: "leaf",
    primaryShade: { light: 6, dark: 5 },
    colors: { leaf, sunny, blush, dark: plum },
    fontFamily: "'Nunito Variable', 'Segoe UI', sans-serif",
    fontFamilyMonospace: "'Cascadia Code', Consolas, monospace",
    headings: {
        fontFamily: "'Fredoka Variable', 'Nunito Variable', sans-serif",
        fontWeight: "600",
    },
    defaultRadius: "md",
    cursorType: "pointer",
    components: {
        Switch: { defaultProps: { color: "leaf" } },
        Tooltip: { defaultProps: { withArrow: true } },
    },
});

// page and text colours that Mantine doesn't take from the scales above
export const cssVariablesResolver: CSSVariablesResolver = () => ({
    variables: {
        "--wp-ink": "#3c2846",
        "--wp-sunny": "#ffd66e",
        "--wp-display": "'Fredoka Variable', 'Nunito Variable', sans-serif",
    },
    light: {
        "--mantine-color-body": "#f6faf2",
        "--mantine-color-text": "#3c2846",
        "--mantine-color-dimmed": "#7a6b86",
        "--mantine-color-default-border": "#e2e8db",
        "--wp-surface": "#ffffff",
        "--wp-sidebar": "#eef5e8",
        "--wp-nav-active-text": "#3c2846",
    },
    dark: {
        "--mantine-color-body": "#211a2b",
        "--mantine-color-text": "#ece4f2",
        "--mantine-color-dimmed": "#a898b5",
        "--mantine-color-default-border": "#3a2e48",
        "--wp-surface": "#2a2136",
        "--wp-sidebar": "#1a1423",
        "--wp-nav-active-text": "#3c2846",
    },
});
