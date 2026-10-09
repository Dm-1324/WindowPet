import { memo, useEffect, useState } from "react";
import { Anchor, Box, Button, Group, Image, Loader, Stack, Text } from "@mantine/core";
import { IconBrandGithub, IconBug, IconCode, IconHeart, IconRefresh } from "@tabler/icons-react";
import { open } from "@tauri-apps/api/shell";
import { getVersion } from "@tauri-apps/api/app";
import { checkForUpdate } from "../../utils/update";
import classes from "./About.module.css";

const REPO = "https://github.com/Dm-1324/WindowPet";

type UpdateState = "checking" | "latest" | "available" | "offline";

const LINKS = [
    { icon: IconBrandGithub, title: "Made by", label: "Dhruv · @Dm-1324", url: "https://github.com/Dm-1324" },
    { icon: IconCode, title: "Source code", label: "github.com/Dm-1324/WindowPet", url: REPO },
    { icon: IconBug, title: "Report a problem", label: "Open an issue on GitHub", url: `${REPO}/issues` },
    { icon: IconHeart, title: "Built on", label: "WindowPet by Seakmeng (MIT licence)", url: "https://github.com/SeakMengs/WindowPet" },
];

function About() {
    const [version, setVersion] = useState("…");
    const [update, setUpdate] = useState<UpdateState>("checking");

    const check = async (prompt = true) => {
        setUpdate("checking");
        // checks this app's own releases; on a button press a dialog offers to install a new one
        const result = await checkForUpdate(prompt);
        setUpdate(result === true ? "available" : result === false ? "latest" : "offline");
    };

    useEffect(() => {
        getVersion().then(setVersion).catch(() => {});
        // the settings window already offered the update when it opened; just show the status
        check(false);
    }, []);

    return (
        <Stack gap="xl">
            <Group gap="lg" wrap="nowrap" className={classes.hero}>
                <Image src="/media/my_avatar.png" alt="" w={84} h={102} fit="contain" />
                <div>
                    <Text className={classes.name}>WindowPet</Text>
                    <Text c="dimmed" fz="sm">Custom Avatar Edition · version {version}</Text>
                    <Group gap="sm" mt="sm">
                        <Button size="xs" variant="light" leftSection={update === "checking" ? <Loader size={12} /> : <IconRefresh size="0.9rem" />}
                            onClick={() => check()} disabled={update === "checking"}>
                            Check for updates
                        </Button>
                        <Text fz="sm" c={update === "available" ? "leaf" : "dimmed"} fw={update === "available" ? 700 : 400}>
                            {update === "checking" && "Checking…"}
                            {update === "latest" && "You're on the latest version 🎉"}
                            {update === "available" && "A new version is ready to install ✨"}
                            {update === "offline" && "Couldn't reach GitHub. Check your connection and try again."}
                        </Text>
                    </Group>
                    <Anchor fz="xs" mt={6} display="inline-block" onClick={() => open(`${REPO}/releases/tag/v${version}`)}>
                        What's new in this version
                    </Anchor>
                </div>
            </Group>

            <Stack gap={0}>
                {LINKS.map(({ icon: Icon, title, label, url }) => (
                    <Group key={title} className={classes.row} wrap="nowrap" gap="md">
                        <Icon size="1.1rem" stroke={1.8} className={classes.rowIcon} />
                        <Text w={130} fz="sm" c="dimmed">{title}</Text>
                        <Anchor fz="sm" fw={600} onClick={() => open(url)}>{label}</Anchor>
                    </Group>
                ))}
            </Stack>

            <Box>
                <Text fz="xs" c="dimmed">
                    Updates come from this app's own GitHub releases and are signed, so only versions published here can install.
                </Text>
            </Box>
        </Stack>
    );
}

export default memo(About);
