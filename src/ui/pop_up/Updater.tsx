import { UpdaterPopupProps } from "../../types/components/type"
import { Anchor, Box, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/api/shell";
import Markdown from "react-markdown";
import { useEffect, useState } from "react";
import remarkGfm from "remark-gfm";

function Updater({ shouldUpdate, manifest }: UpdaterPopupProps) {
    const { t } = useTranslation();
    const [markdown, setMarkDown] = useState<string>();

    useEffect(() => {
        // the release notes come with the update itself
        setMarkDown(manifest?.body ?? "");
    }, [manifest]);

    return (
        <>
            <Box>
                <Text display={"inline"}>{t("WindowPet v available, do you want to install the update?", { version: manifest?.version })}
                    <Anchor mx={"xs"} onClick={() => open(`https://github.com/Dm-1324/WindowPet/releases/latest`)}>{t("(release note)")}</Anchor>
                </Text>
                <Box mx={"lg"}>
                    <Markdown remarkPlugins={[remarkGfm]}>
                        {markdown}
                    </Markdown>
                </Box>
            </Box>
        </>
    )
}

export default Updater;