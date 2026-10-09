import { memo, useEffect, useMemo, useState } from "react";
import { Badge, Button, Code, Divider, Group, Image, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Text, TextInput } from "@mantine/core";
import { invoke } from "@tauri-apps/api/tauri";
import defaultPetConfig from "../../config/pet_config";
import {
    DEFAULT_APPS,
    DEFAULT_HOTKEYS,
    ICompanionSettings,
    isMusicContext,
    isOwnApp,
    ISystemStatus,
    IWeather,
    loadCompanion,
    loadWeather,
    matchApp,
    saveCompanion,
    saveWeather,
} from "../../utils/companion";
import { applyLockScreen, ILockScreenPicture, renderLockScreen } from "../../utils/lockscreen";
import { emitUpdatePetsEvent } from "../../utils/event";
import { DispatchType } from "../../types/IEvents";

type SwitchKey = Exclude<keyof ICompanionSettings, "chattiness" | "weatherCity" | "weather" | "lockScreen">;

const SWITCHES: { key: SwitchKey; title: string; description: string }[] = [
    { key: "follow", title: "Follow the cursor 🐾", description: "Walks after your mouse (also Ctrl+Alt+F)" },
    { key: "lookAtCursor", title: "Look at the cursor 👀", description: "Turns and looks at your mouse when it's nearby" },
    { key: "randomActivities", title: "Random activities", description: "Every now and then naps, works, games, watches a movie or sits by itself" },
    { key: "appAwareness", title: "Join in with your apps", description: "Codes with you in your IDE, watches with you on YouTube/Netflix, games with you" },
    { key: "music", title: "Dance to music 🎵", description: "Dances and announces songs when music is playing" },
    { key: "awayDetection", title: "Nap when you're away", description: "Sleeps when you're away from the keyboard, says welcome back when you return" },
    { key: "nudges", title: "Wellbeing nudges", description: "Reminds you to drink water, stretch and rest your eyes" },
    { key: "pcReactions", title: "React to your PC 💻", description: "Sleepy on low battery, happy when charging, sweaty when the CPU is maxed, sad when the internet drops, guards your laptop when you lock it" },
];

const WEATHER_ICONS: [number, string][] = [[95, "⛈️"], [80, "🌦️"], [71, "❄️"], [51, "🌧️"], [45, "🌫️"], [2, "⛅"], [0, "☀️"]];
const weatherIcon = (code: number) => (WEATHER_ICONS.find(([c]) => code >= c) ?? [0, "🌡️"])[1];

const ACTIVITY_NAMES: { [state: string]: string } = {
    laptop: "💻 coding / working",
    movie: "🍿 watching",
    game: "🎮 gaming",
};

const ACTION_NAMES: { [action: string]: string } = {
    follow: "Follow cursor on/off",
    focus: "Focus timer (Pomodoro) start/stop",
    sleep: "Sleep mode",
    laptop: "Work mode",
    game: "Gaming time",
    movie: "Movie night",
    dance: "Dance",
    greet: "Say hi",
    angry: "Angry mood 😤",
    sad: "Emotional mood 🥺",
    attention: "Attention-seeking mood 👀",
    feed: "Give a snack 🍪",
    normal: "Back to normal",
};

function pretty(accelerator: string): string {
    return accelerator.replace("CommandOrControl", "Ctrl");
}

function Companion() {
    const [settings, setSettings] = useState<ICompanionSettings>(loadCompanion());
    const [status, setStatus] = useState<ISystemStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    // the avatar's own settings (app lists, shortcuts) on top of the defaults
    const personality = useMemo(() => defaultPetConfig.find((p) => p.avatar)?.avatar?.personality ?? {}, []);
    const apps = useMemo(() => ({ ...DEFAULT_APPS, ...(personality.apps ?? {}) }), [personality]);
    const hotkeys = useMemo(() => ({ ...DEFAULT_HOTKEYS, ...(personality.hotkeys ?? {}) }), [personality]);

    useEffect(() => {
        let alive = true;
        const poll = () =>
            invoke<ISystemStatus>("get_system_status")
                .then((s) => alive && (setStatus(s), setError(null)))
                .catch((e) => alive && setError(String(e)));
        poll();
        const timer = setInterval(poll, 2000);
        return () => {
            alive = false;
            clearInterval(timer);
        };
    }, []);

    // weather
    const [city, setCity] = useState(settings.weatherCity);
    const [weather, setWeather] = useState<IWeather | null>(loadWeather());
    const [weatherError, setWeatherError] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);

    const checkWeather = async (name: string) => {
        setChecking(true);
        setWeatherError(null);
        try {
            const w = await invoke<IWeather>("get_weather", { city: name });
            setWeather(w);
            saveWeather(w);
            return true;
        } catch (e) {
            setWeatherError(String(e));
            return false;
        } finally {
            setChecking(false);
        }
    };

    // lock screen picture
    const [picture, setPicture] = useState<ILockScreenPicture | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [lockResult, setLockResult] = useState<{ ok: boolean; message: string; path: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const newPicture = async () => {
        try {
            const pic = await renderLockScreen();
            setPicture(pic);
            setPreview(pic.canvas.toDataURL("image/jpeg", 0.85));
        } catch (e) {
            setLockResult({ ok: false, message: String(e), path: "" });
        }
    };
    useEffect(() => {
        newPicture();
    }, []);

    const setAsLockScreen = async () => {
        setBusy(true);
        try {
            setLockResult(await applyLockScreen(picture ?? undefined));
        } catch (e) {
            setLockResult({ ok: false, message: String(e), path: "" });
        } finally {
            setBusy(false);
        }
    };

    const toggle = <K extends keyof ICompanionSettings>(key: K, value: ICompanionSettings[K]) => {
        const next = { ...settings, [key]: value };
        setSettings(next);
        saveCompanion(next);
        emitUpdatePetsEvent({ dispatchType: DispatchType.CompanionChanged, newValue: JSON.stringify(next) });
    };

    const detected = status && !isOwnApp(status) ? matchApp(status, apps) : null;
    const idle = status ? Math.round(status.idle_ms / 1000) : 0;

    return (
        <Stack gap="md">
            <div>
                {SWITCHES.map((sw) => (
                    <div key={sw.key}>
                        <Group justify="space-between" wrap="nowrap">
                            <div>
                                <Text>{sw.title}</Text>
                                <Text maw={460} fz="xs" c="dimmed">{sw.description}</Text>
                            </div>
                            <Switch size="lg" checked={settings[sw.key]} onChange={(e) => toggle(sw.key, e.currentTarget.checked)} />
                        </Group>
                        <Divider my="sm" />
                    </div>
                ))}
                <Group justify="space-between" wrap="nowrap">
                    <div>
                        <Text>Chattiness 💬</Text>
                        <Text maw={460} fz="xs" c="dimmed">
                            How often it says casual things. Replies, reminders and nudges always show.
                        </Text>
                    </div>
                    <SegmentedControl
                        data={[
                            { value: "quiet", label: "Quiet" },
                            { value: "normal", label: "Normal" },
                            { value: "chatty", label: "Chatty" },
                        ]}
                        value={settings.chattiness}
                        onChange={(v) => toggle("chattiness", v as ICompanionSettings["chattiness"])}
                    />
                </Group>
                <Divider my="sm" />
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <div>
                        <Text>Dress for the weather ☔</Text>
                        <Text maw={420} fz="xs" c="dimmed">
                            Umbrella when it rains, shades when it's sunny, a beanie when it's cold. Uses Open-Meteo (free, no account); only your city name is sent.
                        </Text>
                        {settings.weather && (
                            <Group gap="xs" mt="xs" align="flex-end">
                                <TextInput size="xs" w={180} placeholder="Your city, e.g. Pune" value={city}
                                    onChange={(e) => setCity(e.currentTarget.value)}
                                    onKeyDown={(e) => e.key === "Enter" && city.trim() && checkWeather(city).then((ok) => ok && toggle("weatherCity", city.trim()))} />
                                <Button size="xs" variant="light" loading={checking} disabled={!city.trim()}
                                    onClick={() => checkWeather(city).then((ok) => ok && toggle("weatherCity", city.trim()))}>
                                    Save & check
                                </Button>
                            </Group>
                        )}
                        {settings.weather && weather && !weatherError && (
                            <Text fz="sm" mt={6}>{weatherIcon(weather.code)} {Math.round(weather.temperature)}° in {weather.place}</Text>
                        )}
                        {settings.weather && weatherError && <Text fz="xs" c="red" mt={6}>{weatherError}</Text>}
                    </div>
                    <Switch size="lg" checked={settings.weather} onChange={(e) => toggle("weather", e.currentTarget.checked)} />
                </Group>
            </div>

            <Paper withBorder radius="md" p="md">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <div>
                        <Text fw={600}>Lock screen picture 🔒</Text>
                        <Text maw={430} fz="xs" c="dimmed">
                            Windows doesn't let apps move on the lock screen, so your pet poses for a picture instead,
                            in its current outfit, with a new line each time.
                        </Text>
                    </div>
                    <Stack gap={2} align="flex-end">
                        <Switch size="md" checked={settings.lockScreen} onChange={(e) => toggle("lockScreen", e.currentTarget.checked)} />
                        <Text fz={10} c="dimmed">refresh every 3 h</Text>
                    </Stack>
                </Group>
                {preview && <Image src={preview} radius="sm" mt="sm" alt="Lock screen preview" style={{ border: "1px solid var(--mantine-color-default-border)" }} />}
                <Group gap="xs" mt="sm">
                    <Button size="xs" variant="light" onClick={newPicture}>New line ✨</Button>
                    <Button size="xs" loading={busy} onClick={setAsLockScreen}>Set as lock screen</Button>
                    {lockResult?.path && (
                        <Button size="xs" variant="subtle" onClick={() => invoke("open_folder", { path: lockResult.path.replace(/[\\/][^\\/]+$/, "") })}>
                            Open folder
                        </Button>
                    )}
                </Group>
                {lockResult?.ok && <Text fz="xs" c="teal" mt={6}>Done! Press Win+L to see it 🔒</Text>}
                {lockResult && !lockResult.ok && (
                    <Text fz="xs" c="orange" mt={6}>
                        {lockResult.message}. The picture is saved in Pictures\WindowPet: open{" "}
                        <Text span fz="xs" c="blue" style={{ cursor: "pointer", textDecoration: "underline" }}
                            onClick={() => invoke("open_folder", { path: "ms-settings:lockscreen" })}>
                            lock screen settings
                        </Text>
                        , choose "Picture" and browse to it.
                    </Text>
                )}
            </Paper>

            <Paper withBorder radius="md" p="md">
                <Text fw={600} mb={4}>What your pet sees right now</Text>
                <Text fz="xs" c="dimmed" mb="sm">Updates every 2 seconds. Everything stays on your computer.</Text>
                {error && <Text c="red" fz="sm">Couldn't read the system status: {error}</Text>}
                {status && (
                    <SimpleGrid cols={1} spacing={6}>
                        <Group gap="xs">
                            <Text fz="sm" w={110} c="dimmed">You</Text>
                            <Text fz="sm">{idle < 10 ? "active 🟢" : `idle for ${idle}s ${idle >= 60 ? "🟡" : ""}`}</Text>
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                            <Text fz="sm" w={110} c="dimmed">App in front</Text>
                            <Text fz="sm" lineClamp={1} style={{ flex: 1 }}>
                                <Code>{status.app || "?"}</Code> {status.title}
                            </Text>
                        </Group>
                        <Group gap="xs">
                            <Text fz="sm" w={110} c="dimmed">Joins in with</Text>
                            {isOwnApp(status)
                                ? <Text fz="sm">(WindowPet itself, ignored)</Text>
                                : detected
                                    ? <Badge variant="light">{ACTIVITY_NAMES[detected] ?? detected}</Badge>
                                    : <Text fz="sm">nothing (not in the app list)</Text>}
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                            <Text fz="sm" w={110} c="dimmed">Media</Text>
                            <Text fz="sm" lineClamp={1} style={{ flex: 1 }}>
                                {status.media.title || status.media.playing
                                    ? `${status.media.playing ? "▶ playing" : "⏸ paused"}: ${status.media.title || "(no title)"}${status.media.artist ? ` · ${status.media.artist}` : ""} (${status.media.app || "?"})`
                                    : "nothing playing"}
                                {status.media.playing && (detected === "movie" && !isMusicContext(status) ? " → movie time 🍿" : " → music 🎵")}
                            </Text>
                        </Group>
                        <Group gap="xs" wrap="nowrap">
                            <Text fz="sm" w={110} c="dimmed">PC</Text>
                            <Text fz="sm">
                                {status.battery >= 0 ? `${status.charging ? "⚡" : "🔋"} ${status.battery}%` : "🔌 no battery"}
                                {" · "}CPU {Math.round(status.cpu)}%{" · "}RAM {status.memory}%
                                {" · "}{status.online ? "🌐 online" : "📡 offline"}
                            </Text>
                        </Group>
                    </SimpleGrid>
                )}
            </Paper>

            <Paper withBorder radius="md" p="md">
                <Text fw={600} mb="xs">Keyboard shortcuts</Text>
                <SimpleGrid cols={2} spacing={4}>
                    {Object.entries(hotkeys).map(([action, keys]) => (
                        <Group key={action} gap="xs" wrap="nowrap">
                            <Code>{pretty(keys)}</Code>
                            <Text fz="sm">{ACTION_NAMES[action] ?? action}</Text>
                        </Group>
                    ))}
                </SimpleGrid>
                <Text fz="xs" c="dimmed" mt="xs">
                    Cheer it up: rub your cursor back and forth over it to pet it, or give it a snack
                    (drag the snack onto it). Angry needs 4 hearts, sad 3; a pet is 1 heart, a snack 2.
                </Text>
                <Text fz="xs" c="dimmed" mt={4}>
                    App lists, shortcuts and timings can be changed in src/config/my_avatar.json
                </Text>
            </Paper>
        </Stack>
    );
}

export default memo(Companion);
