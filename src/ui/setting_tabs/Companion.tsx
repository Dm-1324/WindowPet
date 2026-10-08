import { memo, useEffect, useMemo, useState } from "react";
import { Badge, Code, Divider, Group, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Text } from "@mantine/core";
import { invoke } from "@tauri-apps/api/tauri";
import defaultPetConfig from "../../config/pet_config";
import {
    DEFAULT_APPS,
    DEFAULT_HOTKEYS,
    ICompanionSettings,
    isMusicContext,
    isOwnApp,
    ISystemStatus,
    loadCompanion,
    matchApp,
    saveCompanion,
} from "../../utils/companion";
import { emitUpdatePetsEvent } from "../../utils/event";
import { DispatchType } from "../../types/IEvents";

type SwitchKey = Exclude<keyof ICompanionSettings, "chattiness">;

const SWITCHES: { key: SwitchKey; title: string; description: string }[] = [
    { key: "follow", title: "Follow the cursor 🐾", description: "Walks after your mouse (also Ctrl+Alt+F)" },
    { key: "lookAtCursor", title: "Look at the cursor 👀", description: "Turns and looks at your mouse when it's nearby" },
    { key: "randomActivities", title: "Random activities", description: "Every now and then naps, works, games, watches a movie or sits by itself" },
    { key: "appAwareness", title: "Join in with your apps", description: "Codes with you in your IDE, watches with you on YouTube/Netflix, games with you" },
    { key: "music", title: "Dance to music 🎵", description: "Dances and announces songs when music is playing" },
    { key: "awayDetection", title: "Nap when you're away", description: "Sleeps when you're away from the keyboard, says welcome back when you return" },
    { key: "nudges", title: "Wellbeing nudges", description: "Reminds you to drink water, stretch and rest your eyes" },
];

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
            </div>

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
                    App lists, shortcuts and timings can be changed in src/config/my_avatar.json
                </Text>
            </Paper>
        </Stack>
    );
}

export default memo(Companion);
