import { convertFileSrc, invoke } from "@tauri-apps/api/tauri";
import { ISpriteConfig, SpriteType } from "../types/ISpriteConfig";
import { appWindow } from "@tauri-apps/api/window";
import { error } from "tauri-plugin-log-api";
import { avatarPartKey, avatarSourceKey, createAvatarTexture, AVATAR_STATES } from "./avatar";

export class ConfigManager {
    // Config for sprite sheet that's going to be loaded
    private spriteConfig: ISpriteConfig[] = [];
    // Phaser loader plugin
    private load: Phaser.Loader.LoaderPlugin | undefined;
    // Phaser texture manager
    private textures: Phaser.Textures.TextureManager | undefined;
    // Phaser anims manager
    private anims: Phaser.Animations.AnimationManager | undefined;
    // List of registered sprite name to avoid loading duplicate sprite
    private registeredName: Map<string, boolean> = new Map();

    // constants
    // fps for sprite animation
    public readonly FRAME_RATE: number;
    // repeat for sprite animation after it's done, -1 means repeat forever
    private readonly REPEAT: number = -1;

    constructor({
        FRAME_RATE,
    }: {
        FRAME_RATE: number;
    }) {
        this.FRAME_RATE = FRAME_RATE;
    }

    public loadAllSpriteSheet(): void {
        try {
            if (!this.spriteConfig) {
                return;
            }

            this.spriteConfig.forEach((sprite) => {
                this.loadSpriteSheet(sprite);
            });
        } catch (error) {
            console.log("Error in ConfigManager loadAllSpriteSheet()", error);
        }
    }

    public registerSpriteStateAnimation(sprite: ISpriteConfig): void {
        if (!this.anims) {
            error("Anims manager is not set");
            return;
        }

        if (!this.load) {
            error("Loader manager is not set");
            return;
        }
        
        if (sprite.avatar) {
            this.registerAvatar(sprite);
            return;
        }

        // avoid showing broken sprite
        if (!this.validatePetSprite(sprite)) return;

        // in case sprite hasn't loaded yet, we load it
        if (this.textures && !this.textures.exists(sprite.name)) {
            this.loadSpriteSheet(sprite);
            this.load.start();

            this.load.once("complete", () => {
                // if loaded, try to register state animation again
                this.registerSpriteStateAnimation(sprite);
            });
            return;
        }

        // convert sprite states to lowercase because it help to avoid error when user edit their own json file and type state in uppercase
        for (const state in sprite.states) {
            if (state.toLowerCase() !== state) {
                sprite.states[state.toLowerCase()] = sprite.states[state];
                delete sprite.states[state];
            }
        }

        // register state animations for the sprite
        for (const animationConfig of this.getAnimationConfigPerSprite(
            sprite
        )) {
            if (!this.anims.exists(animationConfig.key)) {
                this.anims.create(animationConfig);
            }
        }
    }

    // single-image avatar: build the generated sprite sheet once its source image is loaded
    private registerAvatar(sprite: ISpriteConfig): void {
        if (!this.textures || !this.anims || !this.load) return;

        const frameSize = createAvatarTexture(
            this.textures,
            this.anims,
            sprite.name,
            sprite.avatar
        );
        if (frameSize !== null) {
            sprite.frameSize = frameSize;
            if (!sprite.states) sprite.states = AVATAR_STATES;
            return;
        }

        // source image not loaded yet: load it, then try again
        if (!this.textures.exists(avatarSourceKey(sprite.name))) {
            this.registeredName.delete(sprite.name);
            this.loadSpriteSheet(sprite);
            this.load.once("complete", () => this.registerAvatar(sprite));
            this.load.start();
        }
    }

    public setConfigManager({
        load,
        textures,
        anims,
    }: {
        load: Phaser.Loader.LoaderPlugin;
        textures: Phaser.Textures.TextureManager;
        anims: Phaser.Animations.AnimationManager;
    }): void {
        this.load = load;
        this.textures = textures;
        this.anims = anims;
    }

    public setSpriteConfig(spriteConfig: ISpriteConfig[]): void {
        this.spriteConfig = spriteConfig;
    }

    public getSpriteConfig(): ISpriteConfig[] {
        return this.spriteConfig;
    }

    private loadSpriteSheet(sprite: ISpriteConfig): void {
        if (!this.load) {
            error("Loader manager is not set");
            return;
        }

        // if sprite name is duplicate, we skip it because we can use the same key for different sprite object
        if (this.checkDuplicateName(sprite.name)) {
            return;
        }
        const url =
            sprite.type === SpriteType.CUSTOM
                ? convertFileSrc(sprite.imageSrc)
                : sprite.imageSrc;

        // single-image avatar: load the plain picture, the sheet is generated later
        if (sprite.avatar) {
            this.load.image(avatarSourceKey(sprite.name), url);
            // rig pieces (arms / feet), loaded the same way as the main picture
            (sprite.avatar.parts ?? []).forEach((part, i) => {
                this.load!.image(
                    avatarPartKey(sprite.name, i),
                    sprite.type === SpriteType.CUSTOM ? convertFileSrc(part.src) : part.src
                );
            });
            return;
        }

        // if pet sprite is not valid, we skip it to avoid error
        if (!this.validatePetSprite(sprite)) {
            return;
        }

        this.load.spritesheet({
            key: sprite.name,
            url: url,
            frameConfig: this.getFrameSize(sprite),
        });
    }

    private getAnimationConfigPerSprite(sprite: ISpriteConfig): {
        key: string;
        frames: Phaser.Types.Animations.AnimationFrame[];
        frameRate: number;
        repeat: number;
    }[] {
        if (!sprite.states) {
            return [];
        }

        if (!this.anims) {
            error("Anims manager is not set");
            return [];
        }

        let animationConfig = [];
        const HighestFrameMax = this.getHighestFrameMax(sprite);
        for (const state in sprite.states) {
            // we accept to type of state input, either start, end or spriteLine, frameMax
            // -1 because phaser frame start from 0
            const start =
                sprite.states[state].start !== undefined
                    ? sprite.states[state].start! - 1
                    : (sprite.states[state].spriteLine! - 1) * HighestFrameMax;
            const end =
                sprite.states[state].end !== undefined
                    ? sprite.states[state].end! - 1
                    : start + sprite.states[state].frameMax! - 1;

            animationConfig.push({
                // avoid duplicate key
                key: `${state}-${sprite.name}`,
                frames: this.anims.generateFrameNumbers(sprite.name, {
                    // -1 because phaser frame start from 0
                    start: start,
                    end: end,
                    first: start,
                }),
                frameRate: this.FRAME_RATE,
                repeat: this.REPEAT,
            });
        }
        return animationConfig;
    }

    public getStateName(
        state: string,
        pet: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody
    ): string {
        return `${state}-${pet.texture.key}`;
    }

    private getHighestFrameMax(sprite: ISpriteConfig): number {
        if (sprite.highestFrameMax) {
            return sprite.highestFrameMax;
        }

        let highestFrameMax = 0;
        for (const state in sprite.states) {
            // if frameMax doesn't exist in sprite.states[state] maybe the user specify specific position using start, end
            if (!sprite.states[state].frameMax!) return 0;
            highestFrameMax = Math.max(
                highestFrameMax,
                sprite.states[state].frameMax!
            );
        }

        return highestFrameMax;
    }

    public getFrameSize(sprite: ISpriteConfig): {
        frameWidth: number;
        frameHeight: number;
    } {
        if (sprite.frameSize) {
            return {
                frameWidth: sprite.frameSize,
                frameHeight: sprite.frameSize,
            };
        }

        const frameWidth = sprite.width! / sprite.highestFrameMax!;
        const frameHeight = sprite.height! / sprite.totalSpriteLine!;
        return { frameWidth, frameHeight };
    }

    private checkDuplicateName(name: string): boolean {
        if (this.registeredName.has(name)) {
            console.log(`Sprite name ${name} is already registered`);
            return true;
        }
        this.registeredName.set(name, true);
        return false;
    }

    private validatePetSprite(sprite: ISpriteConfig): boolean {
        if (!sprite.name || !sprite.imageSrc || !sprite.states) {
            // error(`Invalid sprite config: ${sprite.name ?? 'unknown name'}`);
            return false;
        }

        // technically we accept two type of size, user can either only provide frameSize, or width, height, highestFrameMax, totalSpriteLine for us to calculate frameSize
        if (
            !sprite.frameSize &&
            (!sprite.width ||
                !sprite.height ||
                !sprite.highestFrameMax ||
                !sprite.totalSpriteLine)
        ) {
            // error(`Invalid sprite config: ${sprite.name}`);
            return false;
        }

        for (const state in sprite.states) {
            if (
                (!sprite.states[state].spriteLine ||
                    !sprite.states[state].frameMax) &&
                (!sprite.states[state].start || !sprite.states[state].end)
            ) {
                // error(`Invalid sprite config: ${sprite.name}`);
                return false;
            }
        }

        return true;
    }
}

export class InputManager {
    private input: Phaser.Input.InputPlugin | undefined;
    private isIgnoreCursorEvents: boolean = false;
    // objects the mouse was over at the last check, to detect "mouse entered a pet"
    private hovered: Set<Phaser.GameObjects.GameObject> = new Set();
    private onPetHover:
        | ((obj: Phaser.GameObjects.GameObject, x: number) => void)
        | null = null;

    public setOnPetHover(
        callback: (obj: Phaser.GameObjects.GameObject, x: number) => void
    ): void {
        this.onPetHover = callback;
    }

    private readonly IGNORE_CURSOR_EVENTS_DELAY: number = 50;

    public setInputManager({ input }: { input: Phaser.Input.InputPlugin }) {
        this.input = input;
    }

    public checkIsMouseInOnPet(): void {
        try {
            invoke("get_mouse_position").then((event: any) => {
                const hits = this.detectMouseOverPet(event.clientX, event.clientY);

                // notify about pets the mouse just moved onto
                const now = new Set(hits);
                for (const obj of now) {
                    if (!this.hovered.has(obj) && this.onPetHover) {
                        this.onPetHover(obj, this.input!.mousePointer.x);
                    }
                }
                this.hovered = now;

                if (hits.length > 0) {
                    this.turnOffIgnoreCursorEvents();
                    return;
                }

                this.turnOnIgnoreCursorEvents();
            });
        } catch (error) {
            console.log("Error in InputManager checkIsMouseInOnPet()", error);
        }
    }

    public turnOffIgnoreCursorEvents(): void {
        try {
            if (this.isIgnoreCursorEvents) {
                appWindow.setIgnoreCursorEvents(false).then(() => {
                    this.isIgnoreCursorEvents = false;
                });
            }
        } catch (error) {
            console.log(
                "Error in InputManager turnOffIgnoreCursorEvents()",
                error
            );
        }
    }

    public turnOnIgnoreCursorEvents(): void {
        try {
            if (!this.isIgnoreCursorEvents) {
                // slight delay to avoid crash when call setIgnoreCursorEvents too fast
                setTimeout(() => {
                    appWindow.setIgnoreCursorEvents(true).then(() => {
                        this.isIgnoreCursorEvents = true;
                    });
                }, this.IGNORE_CURSOR_EVENTS_DELAY);
            }
        } catch (error) {
            console.log(
                "Error in InputManager turnOnIgnoreCursorEvents()",
                error
            );
        }
    }

    private detectMouseOverPet(
        clientX: number,
        clientY: number
    ): Phaser.GameObjects.GameObject[] {
        try {
            if (!this.input) {
                return [];
            }

            // if not pixel perfect, we can detect mouse over pet using this (with loop through pets array)
            // return Phaser.Geom.Rectangle.Contains(this.pets[0].getBounds(), clientX, clientY);

            // divide clientX,Y by window.devicePixelRatio because the game world is not scaled by devicePixelRatio, and the mouse position we get is scaled by devicePixelRatio
            this.input.mousePointer.x = clientX / window.devicePixelRatio;
            this.input.mousePointer.y = clientY / window.devicePixelRatio;

            // this returns an array of all objects that the pointer is currently over,
            // if array length > 0, it means the pointer is over some sprite object
            return this.input.hitTestPointer(this.input.activePointer);
        } catch (error) {
            console.log("Error in InputManager detectMouseOverPet()", error);
            return [];
        }
    }
}
