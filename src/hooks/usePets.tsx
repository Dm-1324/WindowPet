import { UseQueryResult, useQuery } from "react-query";
import { getAppSettings, setConfig } from "../utils/settings";
import { useSettingStore } from "./useSettingStore";
import { ISpriteConfig } from "../types/ISpriteConfig";
import defaultPetConfig from "../config/pet_config";

const { setPets, setDefaultPet } = useSettingStore.getState();

// This edition has exactly one character: the avatar. Older installs may have saved
// other pets (or none); they are replaced by the avatar, keeping its id if it had one.
const getPets = async () => {
    const saved: ISpriteConfig[] = (await getAppSettings({ configName: "pets.json", withErrorDialog: false })) ?? [];
    const avatar = defaultPetConfig[0];
    const existing = saved.find((pet) => pet.avatar && pet.name === avatar.name);

    const pets: ISpriteConfig[] = [{ ...JSON.parse(JSON.stringify(avatar)), id: existing?.id ?? crypto.randomUUID() }];
    const changed = saved.length !== 1 || !existing || !existing.id;
    if (changed) {
        // only a small reference is stored; the full avatar config always comes from the app
        await setConfig({
            configName: "pets.json",
            newConfig: [{ name: avatar.name, imageSrc: avatar.imageSrc, frameSize: 1, avatar: {}, states: {}, id: pets[0].id }],
        });
    }

    setPets(pets);
    return pets;
};

export function usePets(): UseQueryResult<unknown, Error> {
    return useQuery("pets", getPets, {
        refetchOnWindowFocus: false,
        // disable cache
        cacheTime: 0,
    });
}

const getDefaultPets = async () => {
    setDefaultPet(JSON.parse(JSON.stringify(defaultPetConfig)));
    return true;
};

export function useDefaultPets(): UseQueryResult<unknown, Error> {
    return useQuery("defaultPets", getDefaultPets, {
        refetchOnWindowFocus: false,
        // disable cache
        cacheTime: 0,
    });
}
