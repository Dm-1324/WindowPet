import { ISpriteConfig } from "../types/ISpriteConfig";
import { useSettingStore } from "../hooks/useSettingStore";
import { listen } from "@tauri-apps/api/event";
import {
    DispatchType,
    EventType,
    TRenderEventListener,
} from "../types/IEvents";
import {
    Direction,
    IWorldBounding,
    ISwitchStateOptions,
    Ease,
} from "../types/IPet";
import { info, error } from "tauri-plugin-log-api";
import defaultSettings from "../../src-tauri/src/app/default/settings.json";
import { ConfigManager, InputManager } from "./manager";
import { avatarMeta } from "./avatar";

interface Pet extends Phaser.Types.Physics.Arcade.SpriteWithDynamicBody {
    direction?: Direction;
    availableStates: string[];
    canPlayRandomState: boolean;
    canRandomFlip: boolean;
    id: string;
    // single-image avatar extras
    isAvatar?: boolean;
    baseScale?: number;
    emote?: Phaser.GameObjects.Text | null;
    lastGreetAt?: number;
    downInfo?: { x: number; y: number; t: number };
    fallHandler?: (anim: Phaser.Animations.Animation) => void;
    reactionHandler?: (anim: Phaser.Animations.Animation) => void;
}

export default class Pets extends Phaser.Scene {
    private pets: Pet[] = [];
    private isFlipped: boolean = false;
    private frameCount: number = 0;
    // use this array to store index of pet that is currently climb and crawl
    private petClimbAndCrawlIndex: number[] = [];

    private configManager: ConfigManager;
    // input manager to handle mouse, toggle cursor events to ignore cursor events when mouse is over pet
    private inputManager: InputManager;

    // app settings
    private allowPetInteraction: boolean;
    private allowPetAboveTaskbar: boolean;
    private allowOverridePetScale: boolean;
    private petScale: number;
    private allowPetClimbing: boolean;

    private readonly FORBIDDEN_RAND_STATE: string[] = [
        "fall",
        "climb",
        "drag",
        "crawl",
        "drag",
        "bounce",
        "jump",
    ];
    private readonly FRAME_RATE: number = 9;
    private readonly UPDATE_DELAY: number = 1000 / this.FRAME_RATE;
    private readonly PET_MOVE_VELOCITY: number = this.FRAME_RATE * 6;
    private readonly PET_MOVE_ACCELERATION: number = this.PET_MOVE_VELOCITY * 2;
    private readonly TWEEN_ACCELERATION: number = this.FRAME_RATE * 1.1;
    private readonly RAND_STATE_DELAY: number = 3000;
    private readonly FLIP_DELAY: number = 5000;

    // interactions
    private readonly HOVER_GREET_COOLDOWN: number = 20000;
    private readonly CLICK_REACTIONS: string[] = ["greet", "greet", "dance", "spin"];
    private readonly NOT_ON_GROUND_STATES: string[] = ["climb", "crawl", "drag", "jump", "fall"];
    private readonly EMOTES: { [state: string]: string[] } = {
        greet: ["👋 Hi!", "👋 Hello!", "👋 Hey there!", "😊 Hi!"],
        dance: ["♪ ♫", "♫ ♪ ♬", "🎶"],
        spin: ["✨", "Wheee!"],
        sleep: ["💤", "Zz"],
    };
    // how long a one-off emote stays (looping states like sleep keep theirs)
    private readonly EMOTE_DURATION: number = 2200;

    constructor() {
        super({ key: "Pets" });

        // Initialize other settings without relying on this.input
        this.allowPetInteraction =
            useSettingStore.getState().allowPetInteraction ??
            defaultSettings.allowPetInteraction;
        this.allowPetAboveTaskbar =
            useSettingStore.getState().allowPetAboveTaskbar ??
            defaultSettings.allowPetAboveTaskbar;
        this.allowOverridePetScale =
            useSettingStore.getState().allowOverridePetScale ??
            defaultSettings.allowOverridePetScale;
        this.petScale =
            useSettingStore.getState().petScale ?? defaultSettings.petScale;
        this.allowPetClimbing =
            useSettingStore.getState().allowPetClimbing ??
            defaultSettings.allowPetClimbing;

        this.configManager = new ConfigManager({
            FRAME_RATE: this.FRAME_RATE,
        });
        this.inputManager = new InputManager();
    }

    preload(): void {
        this.configManager.setConfigManager({
            load: this.load,
            textures: this.textures,
            anims: this.anims,
        });

        this.inputManager.setInputManager({ input: this.input });
        const spriteConfig = this.game.registry.get("spriteConfig");
        this.configManager.setSpriteConfig(spriteConfig);
        this.configManager.loadAllSpriteSheet();
    }

    create(): void {
        this.inputManager.turnOnIgnoreCursorEvents();
        this.physics.world.setBoundsCollision(true, true, true, true);
        this.updatePetAboveTaskbar();

        // check all loaded sprite (debug only)
        // console.log(this.textures.list);

        let i = 0;
        // create pets
        for (const sprite of this.configManager.getSpriteConfig()) {
            this.addPet(sprite, i);
            i++;
        }

        // a click that wobbles a few pixels should still count as a click, not a drag
        this.input.dragDistanceThreshold = 4;

        // click on a pet -> it reacts (greet / dance / spin)
        this.input.on(
            "gameobjectdown",
            (pointer: Phaser.Input.Pointer, pet: Pet) => {
                pet.downInfo = { x: pointer.x, y: pointer.y, t: this.time.now };
            }
        );
        this.input.on(
            "gameobjectup",
            (pointer: Phaser.Input.Pointer, pet: Pet) => {
                const down = pet.downInfo;
                pet.downInfo = undefined;
                if (!down) return;
                const moved = Math.hypot(pointer.x - down.x, pointer.y - down.y);
                if (moved > 6 || this.time.now - down.t > 500) return;
                this.reactToClick(pet);
            }
        );

        // mouse comes near a pet -> it turns to you and greets (with a cooldown)
        this.inputManager.setOnPetHover((obj: Phaser.GameObjects.GameObject, x: number) =>
            this.onPetHover(obj as Pet, x)
        );

        // register event
        this.input.on(
            "drag",
            (pointer: any, pet: Pet, dragX: number, dragY: number) => {
                pet.x = dragX;
                pet.y = dragY;

                if (
                    pet.anims &&
                    pet.anims.getName() !==
                        this.configManager.getStateName("drag", pet)
                ) {
                    this.switchState(pet, "drag");
                }

                // disable world bounds when dragging so that pet can go beyond screen
                // @ts-ignore
                if (pet.body!.enable) pet.body!.enable = false;

                // if current pet x is greater than drag start x, flip the pet to the right
                if (pet.x > pet.input!.dragStartX) {
                    if (this.isFlipped) {
                        this.toggleFlipX(pet);
                        this.isFlipped = false;
                    }
                } else {
                    if (!this.isFlipped) {
                        this.toggleFlipX(pet);
                        this.isFlipped = true;
                    }
                }
            }
        );

        this.input.on("dragend", (pointer: any, pet: Pet) => {
            // add tween effect when drag end for smooth throw effect
            this.tweens.add({
                targets: pet,
                // x and y is the position of the pet when drag end
                x: pet.x + pointer.velocity.x * this.TWEEN_ACCELERATION,
                y: pet.y + pointer.velocity.y * this.TWEEN_ACCELERATION,
                duration: 600,
                ease: Ease.QuartEaseOut,
                onComplete: () => {
                    // enable collision when dragging end so that collision will work again and pet go back to the screen
                    if (!pet.body!.enable) {
                        pet.body!.enable = true;

                        // not sure why when enabling body, velocity become 0, and need to take a while to update velocity
                        setTimeout(() => {
                            switch (pet.anims.getName()) {
                                case this.configManager.getStateName(
                                    "climb",
                                    pet
                                ):
                                    this.updateDirection(pet, Direction.UP);
                                    break;
                                case this.configManager.getStateName(
                                    "crawl",
                                    pet
                                ):
                                    this.updateDirection(
                                        pet,
                                        pet.scaleX === -1
                                            ? Direction.UPSIDELEFT
                                            : Direction.UPSIDERIGHT
                                    );
                                    break;
                                default:
                                    return;
                            }
                        }, 50);
                    }
                },
            });

            this.petBeyondScreenSwitchClimb(pet, {
                up: this.getPetBoundTop(pet),
                down: this.getPetBoundDown(pet),
                left: this.getPetBoundLeft(pet),
                right: this.getPetBoundRight(pet),
            });
        });

        this.physics.world.on(
            "worldbounds",
            (
                body: Phaser.Physics.Arcade.Body,
                up: boolean,
                down: boolean,
                left: boolean,
                right: boolean
            ) => {
                const pet = body.gameObject as Pet;
                // if crawl to world bounds, we make the pet jump or spawn on the ground
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("crawl", pet)
                ) {
                    if (left || right) {
                        this.petJumpOrPlayRandomState(pet);
                    }
                    return;
                }

                if (up) {
                    if (!this.allowPetClimbing) {
                        this.petJumpOrPlayRandomState(pet);
                        return;
                    }

                    if (pet.availableStates.includes("crawl")) {
                        this.switchState(pet, "crawl");
                        return;
                    }
                    this.petJumpOrPlayRandomState(pet);
                } else if (down) {
                    this.switchStateAfterPetJump(pet);
                    this.petOnTheGroundPlayRandomState(pet);
                }

                /*
                 * this will check on the ground and mid air if pet is beyond screen
                 * and change pet state accordingly
                 */
                this.petBeyondScreenSwitchClimb(pet, {
                    up: up,
                    down: down,
                    left: left,
                    right: right,
                });
            }
        );

        // listen to setting change from setting window and update settings
        listen<any>(
            EventType.SettingWindowToPetOverlay,
            (event: TRenderEventListener) => {
                switch (event.payload.dispatchType) {
                    case DispatchType.SwitchAllowPetInteraction:
                        this.allowPetInteraction = event.payload
                            .value as boolean;
                        break;
                    case DispatchType.SwitchPetAboveTaskbar:
                        this.allowPetAboveTaskbar = event.payload
                            .value as boolean;
                        this.updatePetAboveTaskbar();

                        // when the user switch from pet above taskbar to not above taskbar, there will be a little space for pet, we force pet to jump or play random state
                        if (!this.allowPetAboveTaskbar) {
                            this.pets.forEach((pet) => {
                                this.petJumpOrPlayRandomState(pet);
                            });
                        }

                        break;
                    case DispatchType.AddPet:
                        this.addPet(
                            event.payload!.value as ISpriteConfig,
                            this.pets.length
                        );
                        break;
                    case DispatchType.RemovePet:
                        this.removePet(event.payload.value as string);
                        break;
                    case DispatchType.OverridePetScale:
                        this.allowOverridePetScale = event.payload
                            .value as boolean;
                        this.allowOverridePetScale
                            ? this.scaleAllPets(this.petScale)
                            : this.scaleAllPets(defaultSettings.petScale);
                        break;
                    case DispatchType.SwitchAllowPetClimbing:
                        this.allowPetClimbing = event.payload.value as boolean;

                        // when the user switch from pet climb to not climb, we force pet to jump or play random state
                        if (!this.allowPetClimbing) {
                            this.pets.forEach((pet) => {
                                this.petJumpOrPlayRandomState(pet);
                            });
                        }
                        break;
                    case DispatchType.ChangePetScale:
                        this.petScale = event.payload.value as number;
                        this.scaleAllPets(this.petScale);
                        break;
                    default:
                        break;
                }
            }
        );

        info("Pets scene loaded");
    }

    update(time: number, delta: number): void {
        this.frameCount += delta;
        this.positionEmotes();

        if (this.frameCount >= this.UPDATE_DELAY) {
            this.frameCount = 0;
            if (this.allowPetInteraction) {
                this.inputManager.checkIsMouseInOnPet();
            }

            this.randomJumpIfPetClimbAndCrawl();
        }
    }

    addPet(sprite: ISpriteConfig, index: number): void {
        this.configManager.registerSpriteStateAnimation(sprite);

        // avatar sheet is generated after its image loads; add the pet once it exists
        if (sprite.avatar && !this.textures.exists(sprite.name)) {
            this.load.once("complete", () => this.addPet(sprite, index));
            return;
        }

        const randomX = Phaser.Math.Between(
            100,
            this.physics.world.bounds.width - 100
        );
        // make the pet jump from the top of the screen
        const petY = 0 + this.configManager.getFrameSize(sprite).frameHeight;
        this.pets[index] = this.physics.add
            .sprite(randomX, petY, sprite.name)
            .setInteractive({
                draggable: true,
                pixelPerfect: true,
            }) as Pet;

        // avatar frames are generated at their final size, so the default scale shows them 1:1 (sharp)
        this.pets[index].isAvatar = !!sprite.avatar;
        this.pets[index].baseScale = sprite.avatar
            ? 1 / defaultSettings.petScale
            : 1;

        this.allowOverridePetScale
            ? this.scalePet(this.pets[index], this.petScale)
            : this.scalePet(this.pets[index], defaultSettings.petScale);

        this.pets[index].setCollideWorldBounds(true, 0, 0, true);

        // store available states to pet (it actual name, not modified name)
        this.pets[index].availableStates = Object.keys(sprite.states);
        this.pets[index].canPlayRandomState = true;
        this.pets[index].canRandomFlip = true;
        this.pets[index].id = sprite.id as string;

        this.petJumpOrPlayRandomState(this.pets[index]);
    }

    removePet(petId: string): void {
        this.pets = this.pets.filter((pet: Pet, index: number) => {
            if (pet.id === petId) {
                this.clearEmote(pet);
                pet.destroy();

                // get pet that use the same texture as the pet that is destroyed
                const petsWithSameTexture = this.pets.filter(
                    (pet: Pet) =>
                        pet.texture.key === this.pets[index].texture.key
                );

                // remove texture if there is only one pet that use the texture because we don't need it anymore
                if (petsWithSameTexture.length === 1) {
                    this.textures.remove(pet.texture.key);
                }

                // remove index from petClimbAndCrawlIndex if it exist because the pet is destroyed
                if (this.petClimbAndCrawlIndex.includes(index)) {
                    this.petClimbAndCrawlIndex =
                        this.petClimbAndCrawlIndex.filter((i) => i !== index);
                }
                return false;
            }
            return true;
        });
    }

    updateDirection(pet: Pet, direction: Direction): void {
        pet.direction = direction;
        this.updateMovement(pet);
    }

    updateStateDirection(pet: Pet, state: string): void {
        let direction = Direction.UNKNOWN;

        switch (state) {
            case "walk":
                // if pet.scaleX is negative, it means pet is facing left, so we set direction to left, else right
                direction = pet.scaleX < 0 ? Direction.LEFT : Direction.RIGHT;
                break;
            case "jump":
                // feel like jump state is opposite of walk so every jump, i flip the pet horizontally :)
                this.toggleFlipX(pet);
                direction = Direction.DOWN;
                break;
            case "climb":
                direction = Direction.UP;
                break;
            case "crawl":
                pet.scaleX > 0
                    ? (direction = Direction.UPSIDELEFT)
                    : (direction = Direction.UPSIDERIGHT);
                break;
            default:
                direction = Direction.UNKNOWN;
                break;
        }

        this.updateDirection(pet, direction);
    }

    // this function will be called every time we update the pet direction using updateDirection
    updateMovement(pet: Pet): void {
        switch (pet.direction) {
            case Direction.RIGHT:
                pet.setVelocity(this.PET_MOVE_VELOCITY, 0);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.LEFT:
                pet.setVelocity(-this.PET_MOVE_VELOCITY, 0);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UP:
                pet.setVelocity(0, -this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0);
                break;
            case Direction.DOWN:
                pet.setVelocity(0, this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0, this.PET_MOVE_ACCELERATION);
                break;
            case Direction.UPSIDELEFT:
                pet.setVelocity(-this.PET_MOVE_VELOCITY);
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, true);
                break;
            case Direction.UPSIDERIGHT:
                pet.setVelocity(
                    this.PET_MOVE_VELOCITY,
                    -this.PET_MOVE_VELOCITY
                );
                pet.setAcceleration(0);
                this.setPetLookToTheLeft(pet, false);
                break;
            case Direction.UNKNOWN:
                pet.setVelocity(0);
                pet.setAcceleration(0);
                break;
            default:
                pet.setVelocity(0);
                pet.setAcceleration(0);
                break;
        }

        // if pet is going up, we disable gravity, if pet is going down, we enable gravity
        const isMovingUp = [
            Direction.UP,
            Direction.UPSIDELEFT,
            Direction.UPSIDERIGHT,
        ].includes(pet.direction as Direction);

        // Set the gravity according to the direction
        // @ts-ignore
        pet.body!.setAllowGravity(!isMovingUp);

        // Set the horizontal velocityX to zero if the direction is up
        if (pet.direction === Direction.UP) {
            pet.setVelocityX(0);
        }
    }

    switchState(
        pet: Pet,
        state: string,
        options: ISwitchStateOptions = {
            repeat: -1,
            delay: 0,
            repeatDelay: 0,
        }
    ): void {
        try {
            // when pet is destroyed, pet.anims will be undefined, there is a chance that this function get called because of setTimeout
            if (!pet.anims) return;

            // prevent pet from playing crawl and climb state if allowPetClimbing is false
            if (!this.allowPetClimbing) {
                if (state === "climb" || state === "crawl") return;
            }

            const animationKey = this.configManager.getStateName(state, pet);
            // if current state is the same as the new state, do nothing
            if (pet.anims && pet.anims.getName() === animationKey) return;
            if (!pet.availableStates.includes(state)) return;

            pet.anims.play({
                key: animationKey,
                repeat: options.repeat,
                delay: options.delay,
                repeatDelay: options.repeatDelay,
            });

            if (state === "climb" || state === "crawl") {
                this.petClimbAndCrawlIndex.push(this.pets.indexOf(pet));
            } else {
                this.petClimbAndCrawlIndex = this.petClimbAndCrawlIndex.filter(
                    (index) => index !== this.pets.indexOf(pet)
                );
            }

            this.updateStateDirection(pet, state);
            this.showEmoteForState(pet, state);
        } catch (err: any) {
            // error could happen when trying to get name
            error(err);
        }
    }

    // if lookToTheLeft is true, pet will look to the left, if false, pet will look to the right
    setPetLookToTheLeft(pet: Pet, lookToTheLeft: boolean): void {
        if (lookToTheLeft) {
            if (pet.scaleX > 0) {
                this.toggleFlipX(pet);
            }
            return;
        }

        if (pet.scaleX < 0) {
            this.toggleFlipX(pet);
        }
    }

    scalePet(pet: Pet, scaleValue: number): void {
        scaleValue = scaleValue * (pet.baseScale ?? 1);
        const scaleX = pet.scaleX > 0 ? scaleValue : -scaleValue;
        const scaleY = pet.scaleY > 0 ? scaleValue : -scaleValue;
        pet.setScale(scaleX, scaleY);
    }

    scaleAllPets(scaleValue: number): void {
        this.pets.forEach((pet) => {
            this.scalePet(pet, scaleValue);

            // force pet to jump or play random state when scale change
            this.petJumpOrPlayRandomState(pet);
        });
    }

    toggleFlipX(pet: Pet): void {
        /*
         * using scale because flipX doesn't flip the hitbox
         * so i have to flip the hitbox manually
         * Note: scaleX negative (- value) = direction left, scaleX positive (+ value) = direction right
         */
        // if hitbox is on the right, flip to the left
        pet.scaleX > 0 ? pet.setOffset(pet.width, 0) : pet.setOffset(0, 0);
        pet.setScale(pet.scaleX * -1, pet.scaleY);
    }

    toggleFlipXThenUpdateDirection(pet: Pet): void {
        this.toggleFlipX(pet);

        switch (pet.direction) {
            case Direction.RIGHT:
                this.updateDirection(pet, Direction.LEFT);
                break;
            case Direction.LEFT:
                this.updateDirection(pet, Direction.RIGHT);
                break;
            case Direction.UPSIDELEFT:
                this.updateDirection(pet, Direction.UPSIDERIGHT);
                break;
            case Direction.UPSIDERIGHT:
                this.updateDirection(pet, Direction.UPSIDELEFT);
                break;
            default:
                break;
        }
    }

    getOneRandomState(pet: Pet): string {
        let randomStateIndex;

        do {
            randomStateIndex = Phaser.Math.Between(
                0,
                pet.availableStates.length - 1
            );
        } while (
            this.FORBIDDEN_RAND_STATE.includes(
                pet.availableStates[randomStateIndex]
            )
        );

        return pet.availableStates[randomStateIndex];
    }

    getOneRandomStateByPet(pet: Pet): string {
        return this.getOneRandomState(pet);
    }

    playRandomState(pet: Pet): void {
        if (!pet.canPlayRandomState) return;

        this.switchState(pet, this.getOneRandomState(pet));
        pet.canPlayRandomState = false;

        // add delay to prevent spamming random state too fast
        setTimeout(() => {
            pet.canPlayRandomState = true;
        }, this.RAND_STATE_DELAY);
    }

    // this function is for when pet jump to the ground, it will call every time pet hit the ground
    switchStateAfterPetJump(pet: Pet): void {
        if (!pet) return;
        if (
            pet.anims &&
            pet.anims.getName() !== this.configManager.getStateName("jump", pet)
        )
            return;

        if (pet.availableStates.includes("fall")) {
            this.switchState(pet, "fall", {
                repeat: 0,
            });

            // after fall animation complete, we play random state
            pet.canPlayRandomState = false;
            const fallKey = this.configManager.getStateName("fall", pet);
            if (pet.fallHandler) pet.off("animationcomplete", pet.fallHandler);
            pet.fallHandler = (anim: Phaser.Animations.Animation) => {
                if (anim.key !== fallKey) return;
                pet.off("animationcomplete", pet.fallHandler);
                pet.canPlayRandomState = true;
                this.playRandomState(pet);
            };
            pet.on("animationcomplete", pet.fallHandler);

            return;
        }
        this.playRandomState(pet);
    }

    getPetGroundPosition(pet: Pet): number {
        return (
            this.physics.world.bounds.height -
            pet.height * Math.abs(pet.scaleY) * pet.originY
        );
    }

    getPetTopPosition(pet: Pet): number {
        return pet.height * Math.abs(pet.scaleY) * pet.originY;
    }

    getPetLeftPosition(pet: Pet): number {
        return pet.width * Math.abs(pet.scaleX) * pet.originX;
    }

    getPetRightPosition(pet: Pet): number {
        return (
            this.physics.world.bounds.width -
            pet.width * Math.abs(pet.scaleX) * pet.originX
        );
    }

    getPetBoundDown(pet: Pet): boolean {
        // we have to check * with scaleY because sometimes user scale the pet
        return pet.y >= this.getPetGroundPosition(pet);
    }

    getPetBoundLeft(pet: Pet): boolean {
        return pet.x <= this.getPetLeftPosition(pet);
    }

    getPetBoundRight(pet: Pet): boolean {
        return pet.x >= this.getPetRightPosition(pet);
    }

    getPetBoundTop(pet: Pet): boolean {
        return pet.y <= this.getPetTopPosition(pet);
    }

    updatePetAboveTaskbar(): void {
        if (this.allowPetAboveTaskbar) {
            // get taskbar height
            const taskbarHeight =
                window.screen.height - window.screen.availHeight;

            // update world bounds to include task bar
            this.physics.world.setBounds(
                0,
                0,
                window.screen.width,
                window.screen.height - taskbarHeight
            );
            return;
        }

        this.physics.world.setBounds(
            0,
            0,
            window.screen.width,
            window.screen.height
        );
    }

    petJumpOrPlayRandomState(pet: Pet): void {
        if (!pet) return;

        if (pet.availableStates.includes("jump")) {
            this.switchState(pet, "jump");
            return;
        }

        this.switchState(pet, this.getOneRandomState(pet));
    }

    petOnTheGroundPlayRandomState(pet: Pet): void {
        if (!pet) {
            return;
        }

        switch (pet.anims.getName()) {
            case this.configManager.getStateName("climb", pet):
                return;
            case this.configManager.getStateName("crawl", pet):
                return;
            case this.configManager.getStateName("drag", pet):
                return;
            case this.configManager.getStateName("jump", pet):
                return;
        }

        const random = Phaser.Math.Between(0, 2000);
        if (
            pet.anims &&
            pet.anims.getName() === this.configManager.getStateName("walk", pet)
        ) {
            if (random >= 0 && random <= 5) {
                this.switchState(pet, "idle");
                setTimeout(() => {
                    if (
                        pet.anims &&
                        pet.anims.getName() !==
                            this.configManager.getStateName("idle", pet)
                    )
                        return;
                    this.switchState(pet, "walk");
                }, Phaser.Math.Between(3000, 6000));
                return;
            }
        } else {
            // enhance random state if pet is not walk
            if (random >= 777 && random <= 800) {
                this.playRandomState(pet);
                return;
            }
        }

        // just some random number to play random state
        if (random >= 888 && random <= 890) {
            // allow random flip only after pet flipped "FLIP_DELAY" time
            if (pet.canRandomFlip) {
                this.toggleFlipXThenUpdateDirection(pet);
                pet.canRandomFlip = false;

                // add delay to prevent spamming pet flip too fast
                setTimeout(() => {
                    pet.canRandomFlip = true;
                }, this.FLIP_DELAY);
            }
        } else if (random >= 777 && random <= 780) {
            this.playRandomState(pet);
        } else if (random >= 170 && random <= 175) {
            this.switchState(pet, "walk");
        }
    }

    randomJumpIfPetClimbAndCrawl(): void {
        if (this.petClimbAndCrawlIndex.length === 0) return;

        for (const index of this.petClimbAndCrawlIndex) {
            const pet = this.pets[index];
            if (!pet) continue;

            switch (pet.anims.getName()) {
                case this.configManager.getStateName("drag", pet):
                    continue;
                case this.configManager.getStateName("jump", pet):
                    continue;
            }

            const random = Phaser.Math.Between(0, 500);

            if (random === 78) {
                let newPetx = pet.x;
                // if pet climb, I want the pet to have some opposite x direction when jump
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("climb", pet)
                ) {
                    // if pet.scaleX is negative, it means pet is facing left, vice versa
                    newPetx =
                        pet.scaleX < 0
                            ? Phaser.Math.Between(pet.x, 500)
                            : Phaser.Math.Between(
                                  pet.x,
                                  this.physics.world.bounds.width - 500
                              );
                }

                // disable body to prevent shaking when jump
                if (pet.body!.enable) pet.body!.enable = false;
                this.switchState(pet, "jump");
                // use tween animation to make jump more smooth
                this.tweens.add({
                    targets: pet,
                    x: newPetx,
                    y: this.getPetGroundPosition(pet),
                    duration: 3000,
                    ease: Ease.QuadEaseOut,
                    onComplete: () => {
                        if (!pet.body!.enable) {
                            pet.body!.enable = true;
                            this.switchStateAfterPetJump(pet);
                        }
                    },
                });
                return;
            }

            // add random pause when climb
            if (random >= 0 && random <= 5) {
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("climb", pet)
                ) {
                    pet.anims.pause();
                    this.updateDirection(pet, Direction.UNKNOWN);
                    // @ts-ignore
                    pet.body!.allowGravity = false;
                    setTimeout(() => {
                        if (pet.anims && !pet.anims.isPlaying) {
                            pet.anims.resume();
                            this.updateDirection(pet, Direction.UP);
                        }
                    }, Phaser.Math.Between(3000, 6000));
                    return;
                } else if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("crawl", pet)
                ) {
                    // add random pause when crawl
                    pet.anims.pause();
                    this.updateDirection(pet, Direction.UNKNOWN);
                    // @ts-ignore
                    pet.body!.allowGravity = false;
                    setTimeout(() => {
                        if (pet.anims && !pet.anims.isPlaying) {
                            pet.anims.resume();
                            // if pet.scaleX is negative, it means pet is facing up side left, vice versa
                            this.updateDirection(
                                pet,
                                pet.scaleX < 0
                                    ? Direction.UPSIDELEFT
                                    : Direction.UPSIDERIGHT
                            );
                        }
                    }, Phaser.Math.Between(3000, 6000));
                    return;
                }
            }
        }
    }

    petBeyondScreenSwitchClimb(pet: Pet, worldBounding: IWorldBounding): void {
        if (!pet) return;

        // if pet is climb and crawl, we don't want to switch state again
        switch (pet.anims.getName()) {
            case this.configManager.getStateName("climb", pet):
                return;
            case this.configManager.getStateName("crawl", pet):
                return;
        }

        // ? debug only
        // pet.availableStates = pet.availableStates.filter(state => state !== 'climb');

        if (worldBounding.left || worldBounding.right) {
            if (
                pet.availableStates.includes("climb") &&
                this.allowPetClimbing
            ) {
                this.switchState(pet, "climb");

                const lastPetX = pet.x;
                // const lastPetX = pet.x + pet.width * Math.abs(pet.scaleX) * pet.originX;
                if (worldBounding.left) {
                    /*
                     * not quite sure if this is correct, but after a lot of experiment
                     * i found out that the pet will be stuck at the left side of the screen
                     * which will result in pet.x = negative number. Because we disable and enable
                     * pet body when drag, the pet will go back with absolute value of pet.x
                     * so i get lastPetX to minus with petLeftPosition to get the correct position
                     */
                    pet.setPosition(
                        lastPetX - this.getPetLeftPosition(pet),
                        pet.y
                    );
                    this.setPetLookToTheLeft(pet, true);
                } else {
                    pet.setPosition(
                        lastPetX + this.getPetRightPosition(pet),
                        pet.y
                    );
                    this.setPetLookToTheLeft(pet, false);
                }
            } else {
                if (worldBounding.down) {
                    // if pet on the ground and beyond screen and doesn't have climb state, we flip the pet
                    this.toggleFlipXThenUpdateDirection(pet);
                } else {
                    // if pet bounding left or right and not on the ground, we make the pet jump or spawn on the ground
                    this.petJumpOrPlayRandomState(pet);
                }
            }
        } else {
            if (worldBounding.down) {
                // if pet is on the ground after being dragged and they are not bounding left or right, we play random state
                if (
                    pet.anims &&
                    pet.anims.getName() ===
                        this.configManager.getStateName("drag", pet)
                ) {
                    this.switchState(pet, this.getOneRandomState(pet));
                }
            } else {
                // if pet is not on the ground and they are not bounding left or right, we make the pet jump or spawn on the ground
                this.petJumpOrPlayRandomState(pet);
            }
        }
    }

    // ---------- interactions ----------

    isOnGround(pet: Pet, allowDrag: boolean = false): boolean {
        if (!pet.anims) return false;
        const current = pet.anims.getName();
        return !this.NOT_ON_GROUND_STATES.some(
            (state) =>
                !(allowDrag && state === "drag") &&
                current === this.configManager.getStateName(state, pet)
        );
    }

    // play a state a couple of times, then go back to walking or standing
    playReaction(pet: Pet, state: string, allowDrag: boolean = false): boolean {
        if (!pet.anims || !pet.availableStates.includes(state)) return false;
        if (!this.isOnGround(pet, allowDrag)) return false;

        const key = this.configManager.getStateName(state, pet);
        if (pet.anims.getName() === key) return false;

        pet.canPlayRandomState = false;
        this.switchState(pet, state, { repeat: state === "dance" ? 2 : 1 });

        if (pet.reactionHandler) pet.off("animationcomplete", pet.reactionHandler);
        pet.reactionHandler = (anim: Phaser.Animations.Animation) => {
            if (anim.key !== key) return;
            pet.off("animationcomplete", pet.reactionHandler);
            pet.canPlayRandomState = true;
            const next = ["walk", "stand"][Phaser.Math.Between(0, 1)];
            this.switchState(pet, pet.availableStates.includes(next) ? next : this.getOneRandomState(pet));
        };
        pet.on("animationcomplete", pet.reactionHandler);

        // safety net in case the reaction is interrupted (e.g. the pet gets dragged)
        setTimeout(() => {
            if (pet.anims) pet.canPlayRandomState = true;
        }, 8000);
        return true;
    }

    reactToClick(pet: Pet): void {
        const options = this.CLICK_REACTIONS.filter((s) => pet.availableStates.includes(s));
        if (options.length === 0) return;
        const state = options[Phaser.Math.Between(0, options.length - 1)];
        if (this.playReaction(pet, state, true)) pet.lastGreetAt = this.time.now;
    }

    onPetHover(pet: Pet, pointerX: number): void {
        if (!pet || !pet.isAvatar || !pet.anims) return;
        const now = this.time.now;
        if (pet.lastGreetAt && now - pet.lastGreetAt < this.HOVER_GREET_COOLDOWN) return;
        if (!this.isOnGround(pet)) return;

        // turn towards the cursor before saying hi
        this.setPetLookToTheLeft(pet, pointerX < pet.x);
        if (this.playReaction(pet, "greet")) pet.lastGreetAt = now;
    }

    // ---------- emotes (little speech bubbles above avatar pets) ----------

    clearEmote(pet: Pet): void {
        if (pet.emote) {
            pet.emote.destroy();
            pet.emote = null;
        }
    }

    showEmoteForState(pet: Pet, state: string): void {
        if (!pet.isAvatar) return;
        this.clearEmote(pet);

        const choices = this.EMOTES[state];
        if (!choices) return;
        const label = choices[Phaser.Math.Between(0, choices.length - 1)];

        const emote = this.add
            .text(pet.x, pet.y, label, {
                fontFamily: '"Segoe UI Emoji", "Segoe UI", "Apple Color Emoji", sans-serif',
                fontSize: "15px",
                color: "#2b2b2b",
                backgroundColor: "#ffffffee",
                padding: { x: 8, y: 4 },
            })
            .setOrigin(0.5, 1)
            .setResolution(window.devicePixelRatio || 1)
            .setDepth(10)
            .setAlpha(0);
        pet.emote = emote;
        this.positionEmotes();

        this.tweens.add({ targets: emote, alpha: 1, duration: 180 });

        // looping states keep the bubble, one-off reactions fade it out
        if (state !== "sleep") {
            this.time.delayedCall(this.EMOTE_DURATION, () => {
                if (pet.emote !== emote) return;
                this.tweens.add({
                    targets: emote,
                    alpha: 0,
                    duration: 250,
                    onComplete: () => {
                        if (pet.emote === emote) this.clearEmote(pet);
                    },
                });
            });
        }
    }

    positionEmotes(): void {
        for (const pet of this.pets) {
            if (!pet || !pet.emote) continue;
            const meta = avatarMeta.get(pet.texture.key);
            const displayHeight = pet.height * Math.abs(pet.scaleY);
            const headTop =
                pet.y - displayHeight * pet.originY + displayHeight * (meta?.headTopRatio ?? 0);
            pet.emote.setPosition(pet.x, Math.max(headTop - 4, pet.emote.height));
        }
    }
}
