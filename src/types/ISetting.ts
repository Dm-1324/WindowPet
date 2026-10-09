import { MemoExoticComponent } from "react";

export interface IGetAppSetting {
    withErrorDialog?: boolean,
    configName?: string,
    key?: string,
}

export enum ColorSchemeType {
    Light = "light",
    Dark = "dark",
}

export type ColorScheme = ColorSchemeType.Light | ColorSchemeType.Dark;

// the order of the tabs in the sidebar
export enum ESettingTab {
    MyAvatar = 0,
    Wardrobe = 1,
    Companion = 2,
    Reminders = 3,
    Settings = 4,
    About = 5,
}

export interface ISettingTabs {
    Component: MemoExoticComponent<() => JSX.Element>,
    title: string,
    description: string,
    Icon: React.ReactNode;
    label: string;
    tab: ESettingTab,
}

export enum DefaultConfigName {
    PET_LINKER = "pet_linker.json",
}