import { memo, useMemo, useState } from "react";
import { Box, Button, Chip, Group, Kbd, Stack, Text } from "@mantine/core";
import { IconEyeOff } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/tauri";
import PhaserCanvas from "../components/PhaserCanvas";
import defaultPetConfig from "../../config/pet_config";
import classes from "./MyPets.module.css";

// the animations worth showing off, in a sensible order
const ANIMATIONS: [string, string][] = [
    ["greet", "Wave"],
    ["walk", "Walk"],
    ["dance", "Dance"],
    ["spin", "Spin"],
    ["happy", "Happy"],
    ["eat", "Snack"],
    ["sit", "Sit"],
    ["laptop", "Work"],
    ["game", "Game"],
    ["movie", "Movie"],
    ["sleep", "Sleep"],
    ["angry", "Angry"],
    ["sad", "Sad"],
    ["attention", "Look at me"],
    ["tired", "Low battery"],
    ["hot", "Hot PC"],
    ["offline", "No internet"],
];

function MyAvatar() {
    const [state, setState] = useState("greet");
    const avatar = useMemo(() => JSON.parse(JSON.stringify(defaultPetConfig[0])), []);

    return (
        <Stack gap="xl">
            <Box className={classes.stage}>
                <Box className={classes.canvas}>
                    <PhaserCanvas pet={avatar} playState={state} key={state} />
                </Box>
                <Box className={classes.taskbar} />
            </Box>

            <div>
                <Text fw={700} mb="xs">Animations</Text>
                <Chip.Group value={state} onChange={(v) => setState(v as string)}>
                    <Group gap={8}>
                        {ANIMATIONS.map(([value, label]) => (
                            <Chip key={value} value={value} size="sm">
                                {label}
                            </Chip>
                        ))}
                    </Group>
                </Chip.Group>
            </div>

            <Group justify="space-between" className={classes.tip} wrap="nowrap">
                <div>
                    <Text fw={700}>Need it out of the way?</Text>
                    <Text fz="sm" c="dimmed">
                        Press <Kbd>Ctrl</Kbd> + <Kbd>Alt</Kbd> + <Kbd>X</Kbd> anywhere to hide or show it. Reminders still find you.
                    </Text>
                </div>
                <Button variant="light" style={{ flexShrink: 0 }} leftSection={<IconEyeOff size="1rem" />} onClick={() => invoke("toggle_pets_visibility")}>
                    Hide / show now
                </Button>
            </Group>
        </Stack>
    );
}

export default memo(MyAvatar);
