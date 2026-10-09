import { ISpriteConfig } from "../types/ISpriteConfig"
import { AVATAR_STATES } from "../scenes/avatar"
import myAvatar from "./my_avatar.json"

// WindowPet: Custom Avatar Edition has a single character: your avatar.
// (Its states and sprite sheet are generated from one picture, see scenes/avatar.ts.)
const defaultPetConfig: ISpriteConfig[] = [
    { ...myAvatar, states: AVATAR_STATES } as unknown as ISpriteConfig,
]

export default defaultPetConfig
