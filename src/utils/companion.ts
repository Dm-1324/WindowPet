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
