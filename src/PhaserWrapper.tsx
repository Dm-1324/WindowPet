import { useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import Pets from "./scenes/Pets";
import { useSettingStore } from "./hooks/useSettingStore";
import { appWindow } from "@tauri-apps/api/window";
import defaultPetConfig from "./config/pet_config";
import { ISpriteConfig } from "./types/ISpriteConfig";

// saved pets keep a copy of their config; for built-in avatars always use the latest one
const withLatestAvatarConfig = (pets: ISpriteConfig[]): ISpriteConfig[] =>
    pets.map((pet) => {
        if (!pet.avatar || pet.type === "custom") return pet;
        const latest = defaultPetConfig.find((p) => p.name === pet.name && p.avatar);
        return latest ? { ...pet, ...JSON.parse(JSON.stringify(latest)), id: pet.id } : pet;
    });

function PhaserWrapper() {
    const phaserDom = useRef<HTMLDivElement>(null);
    const { pets } = useSettingStore();

    const [screenWidth, setScreenWidth] = useState(window.screen.width);
    const [screenHeight, setScreenHeight] = useState(window.screen.height);
    // rebuild the game only when the pet list really changes (not on every new array)
    const petsKey = useMemo(() => JSON.stringify(pets), [pets]);

    useEffect(() => {
        if (!phaserDom.current) return;
        // nothing to show until the saved pets are loaded
        if (pets.length === 0) return;

        const handleResize = () => {
            setScreenWidth(window.screen.width);
            setScreenHeight(window.screen.height);
        };

        window.addEventListener("resize", handleResize);

        // ensure that if component remount user will still be able to touch their screen
        appWindow.setIgnoreCursorEvents(true);

        const phaserConfig: Phaser.Types.Core.GameConfig = {
            type: Phaser.AUTO,
            parent: phaserDom.current,
            backgroundColor: '#ffffff0',
            transparent: true,
            roundPixels: true,
            antialias: true,
            scale: {
                mode: Phaser.Scale.ScaleModes.RESIZE,
                width: screenWidth,
                height: screenHeight,
            },
            physics: {
                default: 'arcade',
                arcade: {
                    debug: false,
                    gravity: { y: 200, x: 0},
                },
            },
            fps: {
                target: 30,
                min: 30,
                smoothStep: true,
            },
            scene: [Pets],
            audio: {
                noAudio: true,
            },
            callbacks: {
                preBoot: (game) => {
                    game.registry.set('spriteConfig', withLatestAvatarConfig(pets));
                    // game.registry.set('defaultPets', defaultPets);
                }
            }
        }

        // create on the next tick: if this effect is cleaned up straight away
        // (React dev mode mounts twice, or pets load right after), nothing is built twice
        let game: Phaser.Game | null = null;
        const start = setTimeout(() => {
            game = new Phaser.Game(phaserConfig);
        }, 0);

        return () => {
            clearTimeout(start);
            game?.destroy(true);
            // reset the dom
            if (phaserDom.current !== null) phaserDom.current.innerHTML = '';
            window.removeEventListener("resize", handleResize);
        }

    }, [petsKey, screenWidth, screenHeight]);

    return (
        <>
            <div ref={phaserDom} />
        </>
    )
}

export default PhaserWrapper;