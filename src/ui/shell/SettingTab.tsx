import { UnstyledButton } from "@mantine/core";
import { memo } from "react";
import clsx from "clsx";
import { ISettingTabProps } from "../../types/components/type";
import classes from "./SettingTab.module.css";

function SettingTab({ Icon, label, active, handleSetTab }: ISettingTabProps) {
    return (
        <UnstyledButton onClick={handleSetTab} className={clsx(classes.link, { [classes.active]: active })} aria-current={active ? "page" : undefined}>
            <span className={classes.icon}>{Icon}</span>
            <span>{label}</span>
        </UnstyledButton>
    );
}

export default memo(SettingTab);
