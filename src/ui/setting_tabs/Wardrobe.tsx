import { memo, useMemo, useState } from "react";
import {
    Box,
    Button,
    CheckIcon,
    ColorSwatch,
    Divider,
    Group,
    Paper,
    SegmentedControl,
    Select,
    Stack,
    Switch,
    Text,
    TextInput,
    Tooltip,
} from "@mantine/core";
import PhaserCanvas from "../components/PhaserCanvas";
import defaultPetConfig from "../../config/pet_config";
import { IconCheck, IconRestore } from "@tabler/icons-react";
import { effectiveWardrobe, IWardrobeSettings, loadWardrobe, saveWardrobe } from "../../utils/companion";
import { emitUpdatePetsEvent } from "../../utils/event";
import { DispatchType } from "../../types/IEvents";

const HATS = [
    { value: "none", label: "No hat" },
    { value: "party", label: "🥳 Party hat" },
    { value: "santa", label: "🎅 Santa hat" },
    { value: "beanie", label: "🧶 Beanie" },
    { value: "crown", label: "👑 Crown" },
    { value: "cap", label: "🧢 Cap" },
    { value: "bow", label: "🎀 Bow" },
    { value: "flower", label: "🌸 Flower" },
];

const GLASSES = [
    { value: "none", label: "No glasses" },
    { value: "round", label: "🤓 Round glasses" },
    { value: "sunglasses", label: "😎 Sunglasses" },
    { value: "hearts", label: "😍 Heart glasses" },
];

const SHIRT_COLORS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa", "#ec407a", "#37474f", "#ffffff"];

const PREVIEW_STATES = [
    { value: "stand", label: "Stand" },
    { value: "greet", label: "Wave" },
    { value: "dance", label: "Dance" },
    { value: "laptop", label: "Work" },
    { value: "sleep", label: "Sleep" },
];

function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <>
            <Group justify="space-between" wrap="nowrap">
                <div>
                    <Text>{title}</Text>
                    {description && <Text maw={420} fz="xs" c="dimmed">{description}</Text>}
                </div>
                {children}
            </Group>
            <Divider my="sm" />
        </>
    );
}

function Wardrobe() {
    // what's applied to the pet vs. what you're trying on in the preview
    const [applied, setApplied] = useState<IWardrobeSettings>(loadWardrobe());
    const [wardrobe, setWardrobe] = useState<IWardrobeSettings>(applied);
    const [previewState, setPreviewState] = useState("stand");
    const [birthday, setBirthday] = useState(wardrobe.birthday ?? "");
    const [justApplied, setJustApplied] = useState(false);

    const dirty = JSON.stringify(wardrobe) !== JSON.stringify(applied);

    // the preview wears the draft outfit (plus seasonal / weather extras, like the real pet)
    const avatar = useMemo(() => {
        const found = defaultPetConfig.find((p) => p.avatar);
        if (!found) return null;
        const pet = JSON.parse(JSON.stringify(found));
        pet.avatar = { ...pet.avatar, wardrobe: effectiveWardrobe(new Date(), wardrobe) };
        return pet;
    }, [wardrobe]);

    const update = (patch: Partial<IWardrobeSettings>) => {
        setWardrobe({ ...wardrobe, ...patch });
        setJustApplied(false);
    };

    const apply = () => {
        saveWardrobe(wardrobe);
        setApplied(wardrobe);
        setJustApplied(true);
        // the overlay also listens to storage changes; the event is a fallback
        emitUpdatePetsEvent({ dispatchType: DispatchType.WardrobeChanged, newValue: JSON.stringify(wardrobe) });
    };

    const reset = () => {
        setWardrobe(applied);
        setBirthday(applied.birthday ?? "");
    };

    const birthdayValid = birthday === "" || /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(birthday);

    return (
        <Stack gap="md">
            {avatar && (
                <Paper withBorder radius="lg" p="md" style={{ position: "sticky", top: 0, zIndex: 2, background: "var(--wp-surface)" }}>
                    <Group justify="space-between" align="center" wrap="nowrap">
                        <Box w={160} h={160} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {/* remount the preview whenever the outfit changes */}
                            <PhaserCanvas pet={avatar} playState={previewState} key={JSON.stringify(wardrobe) + previewState} />
                        </Box>
                        <Stack gap={6} style={{ flex: 1 }}>
                            <Text fw={600}>Preview</Text>
                            <Text fz="xs" c={dirty ? undefined : "dimmed"}>
                                {dirty
                                    ? "Trying it on. Your pet won't wear this until you apply it."
                                    : justApplied
                                        ? "Applied! Your pet loves the new look ✨"
                                        : "This is what your pet is wearing. Pick something new to try it on."}
                            </Text>
                            <SegmentedControl size="xs" data={PREVIEW_STATES} value={previewState} onChange={setPreviewState} />
                            <Group gap="xs" mt={4}>
                                <Button size="xs" leftSection={<IconCheck size="0.9rem" />} disabled={!dirty || !birthdayValid} onClick={apply}>
                                    Apply outfit
                                </Button>
                                <Button size="xs" variant="subtle" color="gray" leftSection={<IconRestore size="0.9rem" />} disabled={!dirty} onClick={reset}>
                                    Undo changes
                                </Button>
                            </Group>
                        </Stack>
                    </Group>
                </Paper>
            )}

            <Box>
                <Row title="Hat">
                    <Select w={190} data={HATS} value={wardrobe.hat ?? "none"} allowDeselect={false}
                        onChange={(v) => update({ hat: (v ?? "none") as IWardrobeSettings["hat"] })} />
                </Row>
                <Row title="Glasses" description="Needs the eyes to be set in the avatar config">
                    <Select w={190} data={GLASSES} value={wardrobe.glasses ?? "none"} allowDeselect={false}
                        onChange={(v) => update({ glasses: (v ?? "none") as IWardrobeSettings["glasses"] })} />
                </Row>
                <Row title="Headphones 🎧">
                    <Switch size="lg" checked={!!wardrobe.headphones} onChange={(e) => update({ headphones: e.currentTarget.checked })} />
                </Row>
                <Row title="T-shirt">
                    <Group gap={6}>
                        <Tooltip label="No shirt">
                            <ColorSwatch component="button" color="transparent" size={24}
                                style={{ border: "1px dashed var(--mantine-color-dimmed)", cursor: "pointer" }}
                                onClick={() => update({ shirt: "none" })}>
                                {(!wardrobe.shirt || wardrobe.shirt === "none") && <CheckIcon width={10} />}
                            </ColorSwatch>
                        </Tooltip>
                        {SHIRT_COLORS.map((color) => (
                            <ColorSwatch key={color} component="button" color={color} size={24} style={{ cursor: "pointer" }}
                                onClick={() => update({ shirt: color })}>
                                {wardrobe.shirt === color && <CheckIcon width={10} color={color === "#ffffff" || color === "#fdd835" ? "#333" : "#fff"} />}
                            </ColorSwatch>
                        ))}
                    </Group>
                </Row>
                {wardrobe.shirt && wardrobe.shirt !== "none" && (
                    <Row title="Shirt print">
                        <SegmentedControl
                            data={[
                                { value: "plain", label: "Plain" },
                                { value: "stripes", label: "Stripes" },
                                { value: "star", label: "★ Star" },
                                { value: "heart", label: "♥ Heart" },
                            ]}
                            value={wardrobe.shirtPattern ?? "plain"}
                            onChange={(v) => update({ shirtPattern: v as IWardrobeSettings["shirtPattern"] })}
                        />
                    </Row>
                )}
                <Row title="Seasonal outfits" description="Santa hat in December, party hat on your birthday">
                    <Switch size="lg" checked={!!wardrobe.seasonal} onChange={(e) => update({ seasonal: e.currentTarget.checked })} />
                </Row>
                <Row title="Your birthday 🎂" description="Month-day, e.g. 03-27. Your pet will celebrate with you">
                    <TextInput w={110} placeholder="MM-DD" value={birthday}
                        error={!birthdayValid}
                        onChange={(e) => {
                            const value = e.currentTarget.value.trim();
                            setBirthday(value);
                            if (value === "" || /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) update({ birthday: value });
                        }} />
                </Row>
            </Box>
        </Stack>
    );
}

export default memo(Wardrobe);
