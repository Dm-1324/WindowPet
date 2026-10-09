import { AppShell, Box, Image, ScrollArea, SegmentedControl, Stack, Text, useMantineColorScheme } from "@mantine/core";
import { IconAlarm, IconInfoCircle, IconMoonStars, IconSettings, IconShirt, IconSparkles, IconSun, IconUserHeart } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { memo, useEffect, useMemo, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { useSettingStore } from "./hooks/useSettingStore";
import { handleSettingChange } from "./utils/handleSettingChange";
import { ColorScheme, ColorSchemeType, ESettingTab, ISettingTabs } from "./types/ISetting";
import { useSettingTabStore } from "./hooks/useSettingTabStore";
import useQueryParams from "./hooks/useQueryParams";
import useInit from "./hooks/useInit";
import { checkForUpdate } from "./utils/update";
import { DispatchType } from "./types/IEvents";
import SettingTabs from "./ui/shell/SettingTabs";
import Title from "./ui/components/Title";
import MyAvatar from "./ui/setting_tabs/MyPets";
import Wardrobe from "./ui/setting_tabs/Wardrobe";
import Companion from "./ui/setting_tabs/Companion";
import Reminders from "./ui/setting_tabs/Reminders";
import Settings from "./ui/setting_tabs/Settings";
import About from "./ui/setting_tabs/About";
import classes from "./SettingWindow.module.css";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

function greeting(): string {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return "Good morning! ☀️";
    if (h >= 12 && h < 17) return "Good afternoon! 👋";
    if (h >= 17 && h < 22) return "Good evening! 🌙";
    return "Up late? 🌙";
}

function SettingWindow() {
    const { theme: colorScheme } = useSettingStore();
    const { t } = useTranslation();
    const queryParams = useQueryParams();
    const { activeTab, setActiveTab } = useSettingTabStore();
    const { setColorScheme } = useMantineColorScheme();
    const [version, setVersion] = useState("");

    // check for update when the settings window opens
    useInit(() => {
        checkForUpdate();
        getVersion().then(setVersion).catch(() => {});
    });

    useEffect(() => {
        // the active tab lives in the url, so a reload keeps you on the same tab
        if (queryParams.has("tab") && Number(queryParams.get("tab")) !== activeTab) {
            setActiveTab(Number(queryParams.get("tab")));
        }
    }, [queryParams, activeTab]);

    const changeColorScheme = (value: ColorScheme) => {
        setColorScheme(value);
        handleSettingChange(DispatchType.ChangeAppTheme, value);
    };

    const settingTabs: ISettingTabs[] = useMemo(() => ([
        {
            Component: MyAvatar,
            title: t("My avatar"),
            description: t("Your desktop buddy. Pick an animation to see it move."),
            Icon: <IconUserHeart size="1.15rem" stroke={1.8} />,
            label: t("My avatar"),
            tab: ESettingTab.MyAvatar,
        },
        {
            Component: Wardrobe,
            title: t("Wardrobe"),
            description: t("Try on hats, glasses and t-shirts, then apply the look you like."),
            Icon: <IconShirt size="1.15rem" stroke={1.8} />,
            label: t("Wardrobe"),
            tab: ESettingTab.Wardrobe,
        },
        {
            Component: Companion,
            title: t("Companion"),
            description: t("Choose what your pet reacts to, and see what it notices."),
            Icon: <IconSparkles size="1.15rem" stroke={1.8} />,
            label: t("Companion"),
            tab: ESettingTab.Companion,
        },
        {
            Component: Reminders,
            title: t("Reminders"),
            description: t("Your pet hops up and tells you when it's time, even if it's hidden."),
            Icon: <IconAlarm size="1.15rem" stroke={1.8} />,
            label: t("Reminders"),
            tab: ESettingTab.Reminders,
        },
        {
            Component: Settings,
            title: t("Settings"),
            description: t("Start-up, size, language and how your pet moves around."),
            Icon: <IconSettings size="1.15rem" stroke={1.8} />,
            label: t("Settings"),
            tab: ESettingTab.Settings,
        },
        {
            Component: About,
            title: t("About"),
            description: t("Version, updates and who made this."),
            Icon: <IconInfoCircle size="1.15rem" stroke={1.8} />,
            label: t("About"),
            tab: ESettingTab.About,
        },
    ]), [t]);

    // an old saved tab number may no longer exist
    const current = settingTabs[activeTab] ?? settingTabs[0];
    const CurrentSettingTab = current.Component;

    return (
        <>
            <Notifications position="top-center" limit={2} />
            <ModalsProvider>
                <AppShell padding={0} navbar={{ width: 216, breakpoint: 0 }}>
                    <AppShell.Navbar className={classes.sidebar} withBorder={false}>
                        <Stack gap={0} h="100%">
                            <Box className={classes.mascot}>
                                <div className={classes.bubble}>{greeting()}</div>
                                <Image src="/media/my_avatar.png" alt="" w={64} h={78} fit="contain" className={classes.pet} />
                                <Text className={classes.appName}>WindowPet</Text>
                            </Box>

                            <Stack gap={4} px="sm" mt="md" style={{ flex: 1 }}>
                                <SettingTabs activeTab={current.tab} settingTabs={settingTabs} />
                            </Stack>

                            <Stack gap={8} p="sm">
                                <SegmentedControl
                                    size="xs"
                                    fullWidth
                                    value={colorScheme}
                                    onChange={(v) => changeColorScheme(v as ColorScheme)}
                                    data={[
                                        { value: ColorSchemeType.Light, label: <IconSun size="0.95rem" aria-label="Light" /> },
                                        { value: ColorSchemeType.Dark, label: <IconMoonStars size="0.95rem" aria-label="Dark" /> },
                                    ]}
                                />
                                {version && <Text fz={11} c="dimmed" ta="center">Version {version}</Text>}
                            </Stack>
                        </Stack>
                    </AppShell.Navbar>
                    <AppShell.Main>
                        <ScrollArea.Autosize h="100vh" key={current.tab}>
                            <Box className={classes.page}>
                                <Title title={current.title} description={current.description} />
                                <CurrentSettingTab key={current.tab} />
                            </Box>
                        </ScrollArea.Autosize>
                    </AppShell.Main>
                </AppShell>
            </ModalsProvider>
        </>
    );
}

export default memo(SettingWindow);
