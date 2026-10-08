import { memo, useEffect, useState } from "react";
import {
    ActionIcon,
    Button,
    Divider,
    Group,
    NumberInput,
    Paper,
    SegmentedControl,
    Stack,
    Text,
    TextInput,
} from "@mantine/core";
import { IconAlarm, IconTrash } from "@tabler/icons-react";
import { addReminder, IReminder, loadReminders, REMINDERS_KEY, removeReminder } from "../../utils/companion";

const QUICK = [5, 15, 30, 60];

function whenLabel(at: number): string {
    const mins = Math.round((at - Date.now()) / 60000);
    const time = new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (mins <= 0) return `now (${time})`;
    if (mins < 60) return `in ${mins} min (${time})`;
    const h = Math.floor(mins / 60);
    return `in ${h} h ${mins % 60} min (${time})`;
}

function Reminders() {
    const [text, setText] = useState("");
    const [mode, setMode] = useState<"in" | "at">("in");
    const [minutes, setMinutes] = useState<number | string>(30);
    const [clock, setClock] = useState("");
    const [list, setList] = useState<IReminder[]>(loadReminders());

    // keep the list fresh: the pet removes reminders once it has told you
    useEffect(() => {
        const refresh = () => setList(loadReminders());
        const timer = setInterval(refresh, 15000);
        const onStorage = (e: StorageEvent) => e.key === REMINDERS_KEY && refresh();
        window.addEventListener("storage", onStorage);
        return () => {
            clearInterval(timer);
            window.removeEventListener("storage", onStorage);
        };
    }, []);

    const dueAt = (): number | null => {
        if (mode === "in") {
            const m = Number(minutes);
            return m > 0 ? Date.now() + m * 60000 : null;
        }
        if (!/^\d{2}:\d{2}$/.test(clock)) return null;
        const [h, m] = clock.split(":").map(Number);
        const at = new Date();
        at.setHours(h, m, 0, 0);
        if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1); // that time tomorrow
        return at.getTime();
    };

    const add = (at: number | null = dueAt()) => {
        if (!text.trim() || !at) return;
        addReminder(text.trim(), at);
        setText("");
        setList(loadReminders());
    };

    return (
        <Stack gap="md">
            <Paper withBorder radius="md" p="md">
                <Stack gap="sm">
                    <TextInput
                        label="What should your pet remind you about?"
                        placeholder="Call mom, stand-up meeting, take out the pizza…"
                        value={text}
                        onChange={(e) => setText(e.currentTarget.value)}
                        onKeyDown={(e) => e.key === "Enter" && add()}
                    />
                    <Group align="flex-end" gap="sm">
                        <SegmentedControl
                            data={[{ value: "in", label: "In…" }, { value: "at", label: "At a time" }]}
                            value={mode}
                            onChange={(v) => setMode(v as "in" | "at")}
                        />
                        {mode === "in" ? (
                            <NumberInput w={120} min={1} max={1440} suffix=" min" value={minutes} onChange={setMinutes} />
                        ) : (
                            <TextInput w={120} type="time" value={clock} onChange={(e) => setClock(e.currentTarget.value)} />
                        )}
                        <Button leftSection={<IconAlarm size="1rem" />} onClick={() => add()} disabled={!text.trim() || !dueAt()}>
                            Remind me
                        </Button>
                    </Group>
                    <Group gap={6}>
                        <Text fz="xs" c="dimmed">Quick:</Text>
                        {QUICK.map((m) => (
                            <Button key={m} size="compact-xs" variant="light" disabled={!text.trim()}
                                onClick={() => add(Date.now() + m * 60000)}>
                                {m < 60 ? `${m} min` : "1 hour"}
                            </Button>
                        ))}
                    </Group>
                </Stack>
            </Paper>

            <div>
                <Text fw={600} mb="xs">Upcoming</Text>
                {list.length === 0 && <Text fz="sm" c="dimmed">No reminders yet. Your pet will hop and tell you when it's time ⏰</Text>}
                {list.map((r) => (
                    <div key={r.id}>
                        <Group justify="space-between" wrap="nowrap">
                            <div>
                                <Text>{r.text}</Text>
                                <Text fz="xs" c="dimmed">{whenLabel(r.at)}</Text>
                            </div>
                            <ActionIcon variant="subtle" color="red" aria-label="Delete reminder"
                                onClick={() => { removeReminder(r.id); setList(loadReminders()); }}>
                                <IconTrash size="1rem" />
                            </ActionIcon>
                        </Group>
                        <Divider my="xs" />
                    </div>
                ))}
            </div>
        </Stack>
    );
}

export default memo(Reminders);
