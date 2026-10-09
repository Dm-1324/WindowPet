/*
 * Settings shared between the Settings window and the pet overlay.
 * Both windows run on the same origin, so localStorage is shared and a change in
 * one window fires a "storage" event in the other.
 */
import { IWardrobe } from "../scenes/avatar";

export const REMINDERS_KEY = "windowpet.reminders";
export const WARDROBE_KEY = "windowpet.wardrobe";

// ---------- reminders ----------

export interface IReminder {
    id: string;
    text: string;
    // epoch milliseconds
    at: number;
}

function read<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
        return fallback;
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage unavailable: nothing we can do
    }
}

export function loadReminders(): IReminder[] {
    return read<IReminder[]>(REMINDERS_KEY, []).sort((a, b) => a.at - b.at);
}

export function saveReminders(list: IReminder[]): void {
    write(REMINDERS_KEY, list);
}

export function addReminder(text: string, at: number): IReminder {
    const reminder = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, at };
    saveReminders([...loadReminders(), reminder]);
    return reminder;
}

export function removeReminder(id: string): void {
    saveReminders(loadReminders().filter((r) => r.id !== id));
}

// ---------- wardrobe ----------

export interface IWardrobeSettings extends IWardrobe {
    // Santa hat in December, party hat on your birthday
    seasonal?: boolean;
    // "MM-DD"
    birthday?: string;
}

export const DEFAULT_WARDROBE: IWardrobeSettings = {
    hat: "none",
    glasses: "none",
    headphones: false,
    shirt: "none",
    shirtPattern: "plain",
    seasonal: true,
    birthday: "",
};

export function loadWardrobe(): IWardrobeSettings {
    return { ...DEFAULT_WARDROBE, ...read<IWardrobeSettings>(WARDROBE_KEY, {}) };
}

export function saveWardrobe(wardrobe: IWardrobeSettings): void {
    write(WARDROBE_KEY, wardrobe);
}

export function isBirthday(wardrobe: IWardrobeSettings = loadWardrobe(), now = new Date()): boolean {
    if (!wardrobe.birthday) return false;
    const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return wardrobe.birthday.trim() === today;
}

// ---------- weather ----------

export const WEATHER_KEY = "windowpet.weather";

export interface IWeather {
    place: string;
    temperature: number;
    code: number;
    is_day: boolean;
    // when it was fetched (epoch ms)
    at?: number;
}

export type WeatherKind = "storm" | "rain" | "snow" | "hot" | "sunny" | "cold" | "cloudy";

// WMO weather codes -> what the pet cares about
export function weatherKind(w: IWeather): WeatherKind {
    const c = w.code;
    if (c >= 95) return "storm";
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return "rain";
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow";
    if (w.temperature <= 12) return "cold";
    if (c <= 1 && w.is_day) return w.temperature >= 30 ? "hot" : "sunny";
    return "cloudy";
}

export function loadWeather(): IWeather | null {
    const w = read<IWeather | null>(WEATHER_KEY, null);
    // forget readings older than 3 hours
    if (!w || !w.at || Date.now() - w.at > 3 * 3600000) return null;
    return w;
}

export function saveWeather(w: IWeather | null): void {
    write(WEATHER_KEY, w ? { ...w, at: Date.now() } : null);
}

// what the pet actually wears today
export function effectiveWardrobe(now = new Date()): IWardrobe {
    const w = loadWardrobe();
    const outfit: IWardrobe = {
        hat: w.hat,
        glasses: w.glasses,
        headphones: w.headphones,
        shirt: w.shirt,
        shirtPattern: w.shirtPattern,
    };
    if (w.seasonal) {
        if (isBirthday(w, now)) outfit.hat = "party";
        else if (now.getMonth() === 11 && (!w.hat || w.hat === "none")) outfit.hat = "santa";
    }
    // dressed for the weather (only adds things, never replaces what you picked)
    const weather = loadCompanion().weather ? loadWeather() : null;
    if (weather) {
        const kind = weatherKind(weather);
        if (kind === "rain" || kind === "storm") outfit.umbrella = true;
        if ((kind === "sunny" || kind === "hot") && (!outfit.glasses || outfit.glasses === "none")) outfit.glasses = "sunglasses";
        if ((kind === "cold" || kind === "snow") && (!outfit.hat || outfit.hat === "none")) outfit.hat = "beanie";
    }
    return outfit;
}

const ITEM_NAMES: { [key: string]: string } = {
    party: "a party hat 🥳",
    santa: "a Santa hat 🎅",
    beanie: "a cosy beanie",
    crown: "a crown 👑",
    cap: "a new cap 🧢",
    bow: "a cute bow 🎀",
    flower: "a flower 🌸",
    round: "new glasses 🤓",
    sunglasses: "cool shades 😎",
    hearts: "heart glasses 😍",
};

// "a new t-shirt", "a crown 👑"... for the pet's happy reaction; null if nothing new was put on
export function describeNewItem(before: IWardrobe, after: IWardrobe): string | null {
    if (after.hat && after.hat !== "none" && after.hat !== before.hat) return ITEM_NAMES[after.hat];
    if (after.glasses && after.glasses !== "none" && after.glasses !== before.glasses) return ITEM_NAMES[after.glasses];
    if (after.headphones && !before.headphones) return "headphones 🎧";
    if (after.shirt && after.shirt !== "none" && (after.shirt !== before.shirt || after.shirtPattern !== before.shirtPattern)) {
        return "a new t-shirt 👕";
    }
    return null;
}

// ---------- companion feature switches (Settings → Companion) ----------

export const COMPANION_KEY = "windowpet.companion";

export interface ICompanionSettings {
    // walk after the mouse cursor
    follow: boolean;
    // turn and look at the cursor when it's near
    lookAtCursor: boolean;
    // sleep / laptop / game / movie / sit on its own every now and then
    randomActivities: boolean;
    // join in with the app in front (coding, movies, games)
    appAwareness: boolean;
    // dance when music plays
    music: boolean;
    // nap when you're away from the keyboard
    awayDetection: boolean;
    // water / stretch / eye-break reminders
    nudges: boolean;
    // how often it says casual things (song names, "Game time!"…); important messages always show
    chattiness: "quiet" | "normal" | "chatty";
    // battery, CPU/RAM, internet and lock/unlock reactions
    pcReactions: boolean;
    // dresses for the weather in your city
    weather: boolean;
    weatherCity: string;
    // keeps the Windows lock screen picture fresh with a new line every few hours
    lockScreen: boolean;
}

export const DEFAULT_COMPANION: ICompanionSettings = {
    follow: false,
    lookAtCursor: true,
    randomActivities: true,
    appAwareness: true,
    music: true,
    awayDetection: true,
    nudges: true,
    chattiness: "normal",
    pcReactions: true,
    weather: false,
    weatherCity: "",
    lockScreen: false,
};

export function loadCompanion(): ICompanionSettings {
    return { ...DEFAULT_COMPANION, ...read<Partial<ICompanionSettings>>(COMPANION_KEY, {}) };
}

export function saveCompanion(settings: ICompanionSettings): void {
    write(COMPANION_KEY, settings);
}

export const DEFAULT_HOTKEYS: { [action: string]: string } = {
    follow: "CommandOrControl+Alt+F",
    focus: "CommandOrControl+Alt+P",
    sleep: "CommandOrControl+Alt+S",
    laptop: "CommandOrControl+Alt+W",
    game: "CommandOrControl+Alt+G",
    movie: "CommandOrControl+Alt+M",
    dance: "CommandOrControl+Alt+D",
    greet: "CommandOrControl+Alt+H",
    angry: "CommandOrControl+Alt+A",
    sad: "CommandOrControl+Alt+E",
    attention: "CommandOrControl+Alt+T",
    feed: "CommandOrControl+Alt+C",
    normal: "CommandOrControl+Alt+N",
};

// ---------- what's happening on the computer ----------

export interface ISystemStatus {
    idle_ms: number;
    app: string;
    title: string;
    media: { playing: boolean; title: string; artist: string; app: string };
    // -1 = no battery
    battery: number;
    charging: boolean;
    cpu: number;
    memory: number;
    online: boolean;
    locked: boolean;
}

// which activity goes with which app; ".exe" entries match the program, others the window title
export const DEFAULT_APPS: { [state: string]: string[] } = {
    laptop: [
        "code.exe", "idea64.exe", "springtoolsuite4.exe", "pycharm64.exe", "webstorm64.exe",
        "devenv.exe", "sublime_text.exe", "notepad++.exe", "postman.exe",
        "winword.exe", "excel.exe", "powerpnt.exe",
    ],
    movie: ["vlc.exe", "potplayermini64.exe", "youtube", "netflix", "prime video", "hotstar", "disney+", "jiocinema"],
    game: ["steam.exe", "epicgameslauncher.exe", "robloxplayerbeta.exe", "minecraft", "valorant", "genshinimpact.exe"],
};

// music services: a "youtube" in these titles is music, not a movie
const MUSIC_HINTS = ["spotify", "youtube music", "music.youtube", "apple music", "soundcloud", "jiosaavn", "gaana", "wynk", "amazon music", "deezer", "tidal"];

export function isOwnApp(status: ISystemStatus): boolean {
    const app = status.app.toLowerCase();
    return app.includes("windowpet") || app.includes("window_pet");
}

// words that give away a song on regular YouTube (title, channel or window title)
const SONG_WORDS = [
    "official audio", "official music video", "music video", "official video", "lyric", "(audio)", "[audio]",
    "lofi", "lo-fi", "remix", "feat.", " ft.", "vevo", " - topic", "jukebox", "full album", "playlist",
    "mashup", "slowed", "reverb", "8d audio", "bass boosted", "acoustic", "unplugged", "song",
];

export function isMusicContext(status: ISystemStatus): boolean {
    const title = status.title.toLowerCase();
    const source = status.media.app.toLowerCase();
    if (MUSIC_HINTS.some((h) => title.includes(h) || source.includes(h.split(" ")[0]))) return true;
    // a regular YouTube video that is clearly a song
    const media = `${status.media.title} ${status.media.artist}`.toLowerCase();
    return SONG_WORDS.some((w) => media.includes(w) || title.includes(w));
}

const APP_NAMES: { [exe: string]: string } = {
    "code.exe": "VS Code", "idea64.exe": "IntelliJ", "springtoolsuite4.exe": "Spring Tool Suite",
    "pycharm64.exe": "PyCharm", "webstorm64.exe": "WebStorm", "devenv.exe": "Visual Studio",
    "sublime_text.exe": "Sublime", "notepad++.exe": "Notepad++", "postman.exe": "Postman",
    "winword.exe": "Word", "excel.exe": "Excel", "powerpnt.exe": "PowerPoint",
    "vlc.exe": "VLC", "steam.exe": "Steam", "epicgameslauncher.exe": "Epic Games",
};

// a friendly name for the app in front ("IntelliJ", "YouTube"…)
export function appName(status: ISystemStatus, apps: { [state: string]: string[] }): string {
    const exe = status.app.toLowerCase();
    if (APP_NAMES[exe]) return APP_NAMES[exe];
    const title = status.title.toLowerCase();
    for (const patterns of Object.values(apps)) {
        const hit = patterns.find((p) => !p.endsWith(".exe") && title.includes(p.toLowerCase()));
        if (hit) return hit.replace(/\b\w/g, (c) => c.toUpperCase()).replace("Youtube", "YouTube");
    }
    return exe.replace(/\.exe$/, "") || "this";
}

// ---------- focus sessions (kept for the day across restarts) ----------

const FOCUS_KEY = "windowpet.focus";

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadFocusSessions(): number {
    const saved = read<{ date: string; sessions: number }>(FOCUS_KEY, { date: "", sessions: 0 });
    return saved.date === today() ? saved.sessions : 0;
}

export function saveFocusSessions(sessions: number): void {
    write(FOCUS_KEY, { date: today(), sessions });
}

// the activity that matches the app in front, or null
export function matchApp(status: ISystemStatus, apps: { [state: string]: string[] }): string | null {
    const app = status.app.toLowerCase();
    const title = status.title.toLowerCase();
    if (!app && !title) return null;
    for (const [state, patterns] of Object.entries(apps)) {
        // a music player in a browser tab is music time, not movie time
        if (state === "movie" && isMusicContext(status)) continue;
        const hit = patterns.some((pattern) => {
            const q = pattern.toLowerCase().trim();
            if (!q) return false;
            return q.endsWith(".exe") ? app === q : title.includes(q);
        });
        if (hit) return state;
    }
    return null;
}
