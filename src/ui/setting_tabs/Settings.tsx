import { Select, Slider } from "@mantine/core";
import { SelectItem } from "./settings/SelectItem";
import languages from "../../locale/languages";
import SettingSwitch from "./settings/SettingSwitch";
import { useTranslation } from "react-i18next";
import { handleSettingChange } from "../../utils/handleSettingChange";
import { useSettingStore } from "../../hooks/useSettingStore";
import { memo, useCallback } from "react";
import { IconLanguage } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/tauri";
import SettingButton from "./settings/SettingButton";
import { DispatchType } from "../../types/IEvents";

interface ISettingsContent {
    title: string,
    description: string,
    checked: boolean,
    dispatchType: DispatchType,
    component?: React.ReactNode,
}

function Settings() {
    const { t, i18n } = useTranslation();
    const { allowAutoStartUp, allowPetAboveTaskbar, allowPetInteraction, allowOverridePetScale, petScale, allowPetClimbing } = useSettingStore();

    const settingSwitches: ISettingsContent[] = [
        {
            title: t("Auto start-up"),
            description: t("Open WindowPet automatically when you sign in to Windows"),
            checked: allowAutoStartUp,
            dispatchType: DispatchType.SwitchAutoWindowStartUp,
        },
        {
            title: t("Walk above the taskbar"),
            description: t("Your pet stands on top of the taskbar instead of the bottom edge of the screen"),
            checked: allowPetAboveTaskbar,
            dispatchType: DispatchType.SwitchPetAboveTaskbar,
        },
        {
            title: t("Pet interactions"),
            description: t("Pick your pet up with the mouse and drop it anywhere"),
            checked: allowPetInteraction,
            dispatchType: DispatchType.SwitchAllowPetInteraction,
        },
        {
            title: t("Climbing"),
            description: t("Your pet can climb the sides of the screen and hang from the top"),
            checked: allowPetClimbing,
            dispatchType: DispatchType.SwitchAllowPetClimbing,
        },
        {
            title: t("Custom size"),
            description: t("Make your pet bigger or smaller with the slider"),
            checked: allowOverridePetScale,
            dispatchType: DispatchType.OverridePetScale,
            component: allowOverridePetScale &&
                <Slider min={0.1} max={1} defaultValue={petScale} my={"sm"} step={0.1} onChangeEnd={(value) => handleSettingChange(DispatchType.ChangePetScale, value)} />,
        }
    ];

    const SettingSwitches = settingSwitches.map((setting, index) => {
        return <SettingSwitch {...setting} key={index} />
    })

    const openConfigFolder = useCallback(async () => {
        const configPath: string = await invoke("combine_config_path", { config_name: "" });
        await invoke("open_folder", { path: configPath });
    }, []);

    return (
        <>
            {SettingSwitches}
            <SettingButton title={t("Settings folder")} description={t("Where WindowPet keeps your settings and logs")} btnLabel={t("Open folder")} btnFunction={openConfigFolder} />
            <Select
                leftSection={<IconLanguage />}
                allowDeselect={false}
                checkIconPosition={"right"}
                my={"sm"}
                label={t("Language")}
                placeholder="Pick one"
                // itemComponent={SelectItem}
                data={languages}
                maxDropdownHeight={400}
                value={i18n.language}
                onChange={(value) => handleSettingChange(DispatchType.ChangeAppLanguage, value as string)}
            />
        </>
    )
}

export default memo(Settings);