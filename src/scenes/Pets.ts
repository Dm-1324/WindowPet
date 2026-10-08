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
import { avatarMeta, IAvatarPersonality } from "./avatar";
import { isRegistered, register, unregister } from "@tauri-apps/api/globalShortcut";
import { invoke } from "@tauri-apps/api/tauri";
import { createAvatarTexture, AVATAR_STATE_DEFS } from "./avatar";
import {
    describeNewItem,
    effectiveWardrobe,
    isBirthday,
    loadReminders,
    saveReminders,
    WARDROBE_KEY,
} from "../utils/companion";
import { IWardrobe } from "./avatar";

interface ISystemStatus {
    idle_ms: number;
    app: string;
    title: string;
    media: { playing: boolean; title: string; artist: string; app: string };
}

interface Pet extends Phaser.Types.Physics.Arcade.SpriteWithDynamicBody {
    direction?: Direction;
    availableStates: string[];
    canPlayRandomState: boolean;
    canRandomFlip: boolean;
    id: string;
    // single-image avatar extras
    isAvatar?: boolean;
    baseScale?: number;
    personality?: IAvatarPersonality;
    bubble?: Phaser.GameObjects.Container | null;
    // timed activity (sleep / laptop / game / sit) and when it ends
    activity?: string;
    activityUntil?: number;
    // activity turned on by a keyboard shortcut: lasts until turned off
    mode?: boolean;
    // activity to start as soon as the pet is back on the ground
    pendingActivity?: { state: string; mode?: boolean; line?: string };
    // started because of the app in front (ends when you leave that app)
    autoActivity?: boolean;
    // napping because you're away
    awayMode?: boolean;
    // walks after the mouse cursor
    follow?: boolean;
    // focus-timer pill above the head
    timerPill?: Phaser.GameObjects.Container | null;
    nextParticleAt?: number;
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
        // long activities are only started by the avatar's own chooser
        "sleep",
        "laptop",
        "game",
        "movie",
        "angry",
        "sad",
        "attention",
        "look",
        "lookup",
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
    private readonly BUBBLE_DURATION: number = 2600;

    // defaults when an avatar's config doesn't say otherwise
    private readonly DEFAULT_PERSONALITY: Required<Omit<IAvatarPersonality, "bubble">> = {
        greetings: ["Good {time}!", "Hi there! 👋", "Oh, hello! 😊"],
        weights: { walk: 30, stand: 12, idle: 10, sit: 8, dance: 5, spin: 3, sleep: 6, laptop: 8, game: 8, movie: 6 },
        durations: {
            sit: [8, 20], sleep: [25, 60], laptop: [15, 40], game: [15, 40], movie: [30, 90],
            angry: [5, 8], sad: [8, 14], attention: [8, 14],
        },
        nightSleepBoost: 5,
        attentionAfter: 8,
        awayAfter: 3,
        apps: {
            laptop: [
                "code.exe", "idea64.exe", "pycharm64.exe", "webstorm64.exe", "devenv.exe",
                "springtoolsuite4.exe", "sublime_text.exe", "notepad++.exe", "windowsterminal.exe",
                "winword.exe", "excel.exe", "powerpnt.exe", "postman.exe",
            ],
            movie: ["vlc.exe", "potplayermini64.exe", "youtube", "netflix", "prime video", "hotstar", "disney+", "jiocinema"],
            game: ["steam.exe", "epicgameslauncher.exe", "robloxplayerbeta.exe", "minecraft", "valorant", "genshinimpact.exe"],
        },
        appCooldown: 2,
        music: true,
        focus: { work: 25, break: 5, longBreak: 15, longEvery: 4, autoNext: false },
        nudges: { water: 60, stretch: 45, eyes: 20 },
        hotkeys: {
            follow: "CommandOrControl+Alt+F",
            focus: "CommandOrControl+Alt+P",
            sleep: "CommandOrControl+Alt+S",
            laptop: "CommandOrControl+Alt+W",
            game: "CommandOrControl+Alt+G",
            movie: "CommandOrControl+Alt+M",
            dance: "CommandOrControl+Alt+D",
            greet: "CommandOrControl+Alt+H",
            normal: "CommandOrControl+Alt+N",
        },
    };
    // states a keyboard shortcut can switch on as a lasting mode
    private readonly MODES: { [state: string]: string } = {
        sleep: "Sleep mode 😴",
        laptop: "Work mode 💻",
        game: "Gaming time! 🎮",
        movie: "Movie night 🍿",
    };
    // last time the user hovered / clicked / dragged a pet
    private lastInteraction: number = 0;
    private registeredHotkeys: string[] = [];

    // what the computer is doing (polled from Rust)
    private status: ISystemStatus | null = null;
    private appCandidate: { state: string | null; since: number } = { state: null, since: 0 };
    private lastAutoAt: { [state: string]: number } = {};
    private lastSong: string = "";
    private nextVibeAt: number = 0;
    // focus timer
    private focus: { phase: "work" | "break" | null; endsAt: number; sessions: number } = {
        phase: null, endsAt: 0, sessions: 0,
    };
    // next time each wellbeing nudge is due
    private nudgeDue: { [kind: string]: number } = {};
    private lastTick: number = 0;
    private lookTimer: number = 0;
    private onStorage = (e: StorageEvent) => {
        if (e.key === WARDROBE_KEY) this.wardrobeChanged();
    };
    private readonly LINES: { [key: string]: string[] } = {
        sleepStart: ["*yawn* 😪", "Nap time…", "So sleepy… 💤"],
        sleepEnd: ["What a nap! ☀️", "*stretch* 🙆", "I'm refreshed!"],
        woken: ["Huh?! 😳", "5 more minutes… 😴", "I'm up! I'm up!"],
        laptopStart: ["Let me check something… 💻", "Work time ⌨️", "Coding a bit…"],
        laptopEnd: ["Done! ✅", "Saved my work 💾", "Time for a break"],
        laptopBusy: ["Busy working… 💻", "Almost done!", "One sec! ⌨️"],
        gameStart: ["Game time! 🎮", "Just one round…", "Let's play!"],
        gameEnd: ["GG! 🏆", "New high score! ⭐", "That was fun!"],
        gameBusy: ["Shh, boss fight! 🎮", "One more level!", "Watch this! ✨"],
        spin: ["Wheee! ✨", "Spinny! 🌀"],
        dance: ["♪ Let's dance!", "Dance break! 💃"],
        movieStart: ["Movie time! 🍿", "Ooh, this looks good 🎬", "Popcorn ready!"],
        movieEnd: ["What a movie! 🎬", "That ending! 😭", "10/10 would watch again"],
        movieBusy: ["Shh! Best part! 🤫", "Want some popcorn? 🍿", "No spoilers!"],
        angryStart: ["Hmph! 😤", "Grr… 💢", "I'm SO mad!"],
        angryEnd: ["…okay, I'm fine now.", "Phew. 😮‍💨", "Sorry, I got grumpy"],
        angryBusy: ["Leave me alone! 😤", "Hmph!", "Not now! 💢"],
        thrown: ["Hey! Don't throw me! 💢", "Ow! That hurt! 😠", "Rude!! 😤"],
        sadStart: ["*sniff* 🥲", "I need a hug 🥺", "Nobody plays with me…"],
        sadEnd: ["Feeling a bit better 🙂", "*sniff* okay…"],
        comforted: ["Thank you 🥹", "You're the best! 💖", "Hugs! 🤗"],
        away: ["Zzz… wake me when you're back 💤", "*yawn* I'll nap till you return"],
        welcomeBack: ["Welcome back! 👋", "You're back! 😊", "Missed you! 💖", "Good {time}! Welcome back ✨"],
        autoLaptop: ["Coding together! 💻", "I'll work too ⌨️", "Let's get stuff done! 💪"],
        autoMovie: ["Ooh, what are we watching? 🍿", "Movie buddy! 🎬", "Popcorn time! 🍿"],
        autoGame: ["Can I play too? 🎮", "Game on! 🕹️", "Go go go! 🎮"],
        song: ["🎵 Ooh, I like this one!", "🎶 Banger!", "🎵 Let's groove!", "🎶 Good choice!"],
        followOn: ["I'll follow you! 🐾", "Lead the way! 🐾"],
        followOff: ["Okay, I'll hang out here 🙂", "Staying put! 🐾"],
        focusStart: ["Focus time! 🍅 Let's go", "Deep work mode 🍅", "Focus! I'll work with you 🍅"],
        focusDone: ["🍅 Done! Take a break ☕", "Great focus! Break time ☕", "Nice work! Stretch a bit ☕"],
        breakOver: ["Break's over! Ready? 💪", "Back at it? Press Ctrl+Alt+P 💪"],
        focusStopped: ["Focus stopped. Good effort! 🙂", "Okay, pausing focus 🙂"],
        water: ["Time for some water 💧", "Stay hydrated! 🥤", "Water break! 💧"],
        stretch: ["Stretch break! 🙆", "Roll your shoulders 🧘", "Stand up and stretch! 🙆"],
        eyes: ["Eye break: look 20 ft away for 20 s 👀", "Rest your eyes a moment 😌", "Blink blink! Look far away 👀"],
        newOutfit: ["Yayy! I got {item}! 😍", "Ooh, {item}! Do I look cute? ✨", "Thank you for {item}! 💖"],
        birthday: ["Happy birthday!! 🎂🎉", "It's your birthday! 🥳🎂"],
        attentionStart: ["Hey! Look at me! 👀", "Psst… 👉👈", "Play with me!", "Notice me! ✨", "Helloooo? 👋"],
        noticed: ["Yay! You noticed! 💖", "Hehe, hi! 😊", "Finally! 🥳"],
        modeOff: ["Back to normal! 🙂", "Okay, I'm free!", "What's next? ✨"],
        sleepMode: ["Zzz… (sleep mode) 😴", "*snore* 💤"],
    };
    private readonly PARTICLES: { [state: string]: { texts: string[]; every: [number, number]; colors: string[] } } = {
        sleep: { texts: ["z", "Z", "Z"], every: [1000, 1300], colors: ["#7a6cc9"] },
        dance: { texts: ["♪", "♫", "♬"], every: [400, 650], colors: ["#ff6b9a", "#5aa9ff", "#ffb02e", "#7bd389"] },
        game: { texts: ["★", "+1", "✦", "🎮"], every: [1200, 2200], colors: ["#ffb02e", "#ff6b9a", "#5aa9ff"] },
        laptop: { texts: ["</>", "{ }", "💻", "☕", "✓"], every: [1600, 2600], colors: ["#3f8efc", "#2bb673", "#8a63d2"] },
        movie: { texts: ["🍿", "😂", "😮", "🎬", "♥"], every: [1800, 3200], colors: ["#e8433f", "#ffb02e", "#ff6b9a"] },
        angry: { texts: ["💢", "💨", "#@!", "💢"], every: [450, 750], colors: ["#e8433f", "#c62828"] },
        sad: { texts: ["💧"], every: [900, 1400], colors: ["#5aa9ff"] },
        attention: { texts: ["❗", "👀", "💖", "✨", "❓"], every: [450, 750], colors: ["#ff6b9a", "#ffb02e", "#5aa9ff"] },
    };
    // particles that drop (tears) instead of floating up
    private readonly FALLING_PARTICLES: string[] = ["sad"];

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

        this.lastInteraction = this.time.now;
        this.registerHotkeys();
        this.events.once("destroy", () => this.unregisterHotkeys());

        // companion features: what the computer is doing, outfits, reminders
        this.time.addEvent({ delay: 2000, loop: true, callback: () => this.pollSystem() });
        window.addEventListener("storage", this.onStorage);
        this.events.once("destroy", () => window.removeEventListener("storage", this.onStorage));
        const nudges = this.personality().nudges;
        for (const kind of Object.keys(nudges)) this.nudgeDue[kind] = Date.now() + nudges[kind] * 60000;
        if (isBirthday()) {
            this.time.delayedCall(4000, () => this.forEachAvatar((pet) => {
                this.showBubble(pet, this.pick(this.LINES.birthday), 5000);
                this.playReaction(pet, "dance", true);
            }));
        }

        // click on a pet -> it reacts (greet / dance / spin)
        this.input.on(
            "gameobjectdown",
            (pointer: Phaser.Input.Pointer, pet: Pet) => {
                pet.downInfo = { x: pointer.x, y: pointer.y, t: this.time.now };
                this.lastInteraction = this.time.now;
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
            this.lastInteraction = this.time.now;
            // thrown hard? it'll be grumpy once it lands
            const speed = Math.hypot(pointer.velocity.x, pointer.velocity.y);
            if (pet.isAvatar && speed > 18 && !pet.mode) {
                pet.pendingActivity = { state: "angry", line: this.pick(this.LINES.thrown) };
            }
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
                    case DispatchType.WardrobeChanged:
                        this.wardrobeChanged();
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
        this.updateAvatars(time);
        this.lookTimer += delta;
        if (this.lookTimer >= 250) {
            this.lookTimer = 0;
            this.updateLookAndFollow();
        }
        if (time - this.lastTick >= 1000) {
            this.lastTick = time;
            this.tickCompanion();
        }
        this.positionBubbles();

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
        this.pets[index].personality = sprite.avatar?.personality;
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
                this.clearBubble(pet);
                this.setTimerPill(pet, null);
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
        if (!pet.canPlayRandomState || pet.activity || pet.follow) return;

        // avatars pick from their own weighted list, including long activities
        if (pet.isAvatar && this.playAvatarRandomState(pet)) return;

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
        // busy sleeping / working / gaming / following the cursor: don't wander off
        if (pet.activity || pet.follow) return;

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

    // the plain state name ("walk") from the animation key ("walk-My Avatar")
    currentState(pet: Pet): string {
        const key = pet.anims?.getName() ?? "";
        const suffix = `-${pet.texture.key}`;
        return key.endsWith(suffix) ? key.slice(0, -suffix.length) : key;
    }

    isOnGround(pet: Pet, allowDrag: boolean = false): boolean {
        if (!pet.anims) return false;
        const current = this.currentState(pet);
        return !this.NOT_ON_GROUND_STATES.some(
            (state) => !(allowDrag && state === "drag") && current === state
        );
    }

    personality(pet?: Pet) {
        const own = pet?.personality ?? {};
        const d = this.DEFAULT_PERSONALITY;
        return {
            ...d,
            ...own,
            weights: { ...d.weights, ...(own.weights ?? {}) },
            durations: { ...d.durations, ...(own.durations ?? {}) },
            hotkeys: { ...d.hotkeys, ...(own.hotkeys ?? {}) },
            apps: { ...d.apps, ...(own.apps ?? {}) },
            focus: { ...d.focus, ...(own.focus ?? {}) },
            nudges: { ...d.nudges, ...(own.nudges ?? {}) },
        };
    }

    // free to start something new (on the ground, not mid-air or being dragged)
    canStartActivity(pet: Pet): boolean {
        if (!pet.anims) return false;
        const state = this.currentState(pet);
        if (state === "fall") return !pet.anims.isPlaying; // landed
        return this.isOnGround(pet);
    }

    pick<T>(items: T[]): T {
        return items[Phaser.Math.Between(0, items.length - 1)];
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
            const next = this.pick(["walk", "stand"]);
            this.switchState(pet, pet.availableStates.includes(next) ? next : this.getOneRandomState(pet));
        };
        pet.on("animationcomplete", pet.reactionHandler);

        // safety net in case the reaction is interrupted (e.g. the pet gets dragged)
        setTimeout(() => {
            if (pet.anims && !pet.activity) pet.canPlayRandomState = true;
        }, 8000);
        return true;
    }

    reactToClick(pet: Pet): void {
        // busy pets answer instead of dropping what they're doing
        this.lastInteraction = this.time.now;
        switch (pet.activity) {
            case "sleep":
                if (pet.mode) {
                    this.showBubble(pet, this.pick(this.LINES.sleepMode));
                    return;
                }
                this.endActivity(pet);
                this.showBubble(pet, this.pick(this.LINES.woken));
                this.switchState(pet, "stand");
                pet.lastGreetAt = this.time.now;
                return;
            case "laptop":
                if (this.focus.phase === "work") {
                    this.showBubble(pet, `Focus! 🍅 ${this.formatLeft()} left`);
                    return;
                }
                this.showBubble(pet, this.pick(this.LINES.laptopBusy));
                return;
            case "game":
                this.showBubble(pet, this.pick(this.LINES.gameBusy));
                return;
            case "movie":
                this.showBubble(pet, this.pick(this.LINES.movieBusy));
                return;
            case "angry":
                this.showBubble(pet, this.pick(this.LINES.angryBusy));
                return;
            case "sad":
                // comfort it
                this.endActivity(pet);
                this.showBubble(pet, this.pick(this.LINES.comforted));
                this.switchState(pet, "stand");
                this.time.delayedCall(900, () => this.playReaction(pet, "greet"));
                pet.lastGreetAt = this.time.now;
                return;
            case "attention":
                this.noticed(pet);
                return;
            case "sit":
                this.endActivity(pet);
                break;
        }

        const options = this.CLICK_REACTIONS.filter((s) => pet.availableStates.includes(s));
        if (options.length === 0) return;
        if (this.playReaction(pet, this.pick(options), true)) pet.lastGreetAt = this.time.now;
    }

    onPetHover(pet: Pet, pointerX: number): void {
        if (!pet || !pet.isAvatar || !pet.anims) return;
        this.lastInteraction = this.time.now;
        if (pet.activity === "attention") {
            this.setPetLookToTheLeft(pet, pointerX < pet.x);
            this.noticed(pet);
            return;
        }
        if (pet.activity) return;
        const now = this.time.now;
        if (pet.lastGreetAt && now - pet.lastGreetAt < this.HOVER_GREET_COOLDOWN) return;
        if (!this.isOnGround(pet)) return;

        // turn towards the cursor before saying hi
        this.setPetLookToTheLeft(pet, pointerX < pet.x);
        if (this.playReaction(pet, "greet")) pet.lastGreetAt = now;
    }

    // ---------- activities ----------

    timeOfDay(): string {
        const h = new Date().getHours();
        if (h >= 5 && h < 12) return "morning";
        if (h >= 12 && h < 17) return "afternoon";
        if (h >= 17 && h < 22) return "evening";
        return "night";
    }

    // weighted random pick for avatars; returns false to fall back to the default chooser
    playAvatarRandomState(pet: Pet): boolean {
        if (!this.isOnGround(pet)) return false;
        const p = this.personality(pet);
        const night = this.timeOfDay() === "night";

        const options: [string, number][] = Object.entries(p.weights)
            .filter(([state, weight]) => weight > 0 && pet.availableStates.includes(state))
            .map(([state, weight]) => [state, state === "sleep" && night ? weight * p.nightSleepBoost : weight]);
        if (options.length === 0) return false;

        let roll = Math.random() * options.reduce((sum, [, w]) => sum + w, 0);
        let choice = options[0][0];
        for (const [state, weight] of options) {
            roll -= weight;
            if (roll <= 0) {
                choice = state;
                break;
            }
        }

        if (p.durations[choice]) {
            this.startActivity(pet, choice);
            return true;
        }

        this.switchState(pet, choice);
        pet.canPlayRandomState = false;
        setTimeout(() => {
            if (!pet.activity) pet.canPlayRandomState = true;
        }, this.RAND_STATE_DELAY);
        return true;
    }

    startActivity(pet: Pet, state: string, mode: boolean = false, line?: string): boolean {
        if (!pet.availableStates.includes(state)) return false;
        if (!this.canStartActivity(pet)) {
            // in the air / being dragged: do it after landing
            pet.pendingActivity = { state, mode, line };
            return false;
        }
        const [min, max] = this.personality(pet).durations[state] ?? [10, 20];

        pet.pendingActivity = undefined;
        this.switchState(pet, state);
        pet.activity = state;
        pet.mode = mode;
        pet.activityUntil = mode ? Infinity : this.time.now + Phaser.Math.Between(min * 1000, max * 1000);
        pet.canPlayRandomState = false;
        pet.nextParticleAt = this.time.now + 800;
        if (state === "attention") this.lastInteraction = this.time.now;

        const lines = this.LINES[`${state}Start`];
        const text = line ?? (mode ? this.MODES[state] : lines ? this.pick(lines) : undefined);
        if (text) this.showBubble(pet, text);
        return true;
    }

    noticed(pet: Pet): void {
        this.endActivity(pet);
        this.showBubble(pet, this.pick(this.LINES.noticed));
        pet.lastGreetAt = this.time.now;
        this.switchState(pet, "stand");
        this.time.delayedCall(700, () => this.playReaction(pet, "dance"));
    }

    endActivity(pet: Pet, finished: boolean = false): void {
        const was = pet.activity;
        pet.activity = undefined;
        pet.activityUntil = undefined;
        pet.mode = false;
        pet.autoActivity = false;
        pet.awayMode = false;
        pet.canPlayRandomState = true;
        if (!finished || !was) return;

        // nobody noticed it asking for attention… now it's sad
        if (was === "attention") {
            this.startActivity(pet, "sad");
            return;
        }

        const lines = this.LINES[`${was}End`];
        if (lines) this.showBubble(pet, this.pick(lines));
        this.switchState(pet, "stand");
        // stretch for a moment, then carry on
        setTimeout(() => {
            if (pet.anims && !pet.activity && this.currentState(pet) === "stand") this.switchState(pet, "walk");
        }, 1800);
    }

    updateAvatars(time: number): void {
        for (const pet of this.pets) {
            if (!pet || !pet.isAvatar || !pet.anims) continue;
            const state = this.currentState(pet);

            if (pet.activity) {
                if (state !== pet.activity) {
                    if (pet.mode) {
                        // modes survive being dragged around: resume after landing
                        if (this.canStartActivity(pet)) this.switchState(pet, pet.activity);
                    } else {
                        // interrupted (dragged, fell...)? forget the activity
                        this.endActivity(pet);
                    }
                } else if (time >= (pet.activityUntil ?? 0)) {
                    this.endActivity(pet, true);
                    continue;
                }
            } else if (pet.pendingActivity && this.canStartActivity(pet)) {
                const next = pet.pendingActivity;
                this.startActivity(pet, next.state, next.mode, next.line);
            } else {
                // ignored for a while? start asking for attention
                const after = this.personality(pet).attentionAfter;
                const userPresent = !this.status || this.status.idle_ms < 60000;
                if (after > 0 && userPresent && time - this.lastInteraction > after * 60000 && this.canStartActivity(pet)) {
                    this.startActivity(pet, "attention");
                }
            }

            const fx = this.PARTICLES[state];
            if (fx && time >= (pet.nextParticleAt ?? 0)) {
                pet.nextParticleAt = time + Phaser.Math.Between(fx.every[0], fx.every[1]);
                this.spawnParticle(pet, state, fx);
            }
        }
    }

    // ---------- speech bubbles & floating particles ----------

    // point just above the head (or the head on the pillow when sleeping)
    headPoint(pet: Pet): { x: number; y: number } {
        const meta = avatarMeta.get(pet.texture.key);
        const w = pet.width * Math.abs(pet.scaleX);
        const h = pet.height * Math.abs(pet.scaleY);
        const left = pet.x - w * pet.originX;
        const top = pet.y - h * pet.originY;
        if (meta && this.currentState(pet) === "sleep") {
            // frames are mirrored when the pet faces left
            const hx = pet.scaleX < 0 ? 1 - meta.sleepHead.x : meta.sleepHead.x;
            return { x: left + hx * w, y: top + meta.sleepHead.y * h };
        }
        return { x: pet.x, y: top + h * (meta?.headTopRatio ?? 0) };
    }

    color(hex: string | undefined, fallback: string): number {
        return Phaser.Display.Color.HexStringToColor(hex ?? fallback).color;
    }

    clearBubble(pet: Pet): void {
        if (pet.bubble) {
            pet.bubble.destroy();
            pet.bubble = null;
        }
    }

    showBubble(pet: Pet, text: string, duration: number = this.BUBBLE_DURATION): void {
        this.clearBubble(pet);
        const style = pet.personality?.bubble ?? {};
        const fill = this.color(style.fill, "#FFF6E5");
        const stroke = this.color(style.stroke, "#5B4636");

        const label = this.add
            .text(0, 0, text, {
                fontFamily: style.font ?? '"Segoe UI Emoji", "Segoe UI", sans-serif',
                fontSize: `${style.fontSize ?? 14}px`,
                color: style.text ?? "#4A3B33",
                fontStyle: "bold",
            })
            .setOrigin(0.5)
            .setResolution(window.devicePixelRatio || 1);

        const padX = 11, padY = 6, tail = 8, radius = 11;
        const bw = Math.ceil(label.width + padX * 2);
        const bh = Math.ceil(label.height + padY * 2);
        const top = -bh - tail;

        const g = this.add.graphics();
        // soft shadow
        g.fillStyle(0x000000, 0.14);
        g.fillRoundedRect(-bw / 2 + 2, top + 3, bw, bh, radius);
        // body + outline
        g.fillStyle(fill, 1);
        g.lineStyle(2, stroke, 1);
        g.fillRoundedRect(-bw / 2, top, bw, bh, radius);
        g.strokeRoundedRect(-bw / 2, top, bw, bh, radius);
        // tail pointing at the head
        g.fillTriangle(-7, -tail - 1.5, 7, -tail - 1.5, 0, 0);
        g.lineBetween(-7, -tail, 0, 0);
        g.lineBetween(7, -tail, 0, 0);
        // little shine
        g.fillStyle(0xffffff, 0.7);
        g.fillCircle(-bw / 2 + 8, top + 7, 2.2);

        label.setPosition(0, top + bh / 2);
        const bubble = this.add.container(0, 0, [g, label]).setDepth(10).setScale(0.3).setAlpha(0);
        bubble.setSize(bw, bh + tail);
        pet.bubble = bubble;
        this.positionBubbles();

        // pop in, hang around, float away
        this.tweens.add({ targets: bubble, scale: 1, alpha: 1, duration: 260, ease: Ease.BackEaseOut });
        this.time.delayedCall(duration, () => {
            if (pet.bubble !== bubble) return;
            this.tweens.add({
                targets: bubble,
                alpha: 0,
                scale: 0.85,
                duration: 220,
                onComplete: () => {
                    if (pet.bubble === bubble) this.clearBubble(pet);
                },
            });
        });
    }

    positionBubbles(): void {
        const screenW = this.physics.world.bounds.width;
        for (const pet of this.pets) {
            if (!pet) continue;
            const head = this.headPoint(pet);
            let y = head.y - 2;
            if (pet.timerPill) {
                const half = pet.timerPill.width / 2;
                pet.timerPill.setPosition(Phaser.Math.Clamp(head.x, half + 4, screenW - half - 4), Math.max(y, 28));
                y -= pet.timerPill.height + 4;
            }
            if (!pet.bubble) continue;
            const half = pet.bubble.width / 2;
            // keep the bubble on screen
            const x = Phaser.Math.Clamp(head.x, half + 4, screenW - half - 4);
            pet.bubble.setPosition(x, Math.max(y, pet.bubble.height + 4));
        }
    }

    spawnParticle(pet: Pet, state: string, fx: { texts: string[]; colors: string[] }): void {
        const head = this.headPoint(pet);
        const text =
            state === "sleep"
                ? fx.texts[Math.floor(this.time.now / 1100) % fx.texts.length]
                : this.pick(fx.texts);
        const size = state === "sleep" ? 13 + (Math.floor(this.time.now / 1100) % 3) * 4 : 15;
        const dir = pet.scaleX < 0 ? -1 : 1;

        const p = this.add
            .text(head.x + Phaser.Math.Between(-8, 8), head.y - 4, text, {
                fontFamily: '"Segoe UI Emoji", "Segoe UI", sans-serif',
                fontSize: `${size}px`,
                fontStyle: "bold",
                color: this.pick(fx.colors),
                stroke: "#ffffff",
                strokeThickness: 3,
            })
            .setOrigin(0.5)
            .setResolution(window.devicePixelRatio || 1)
            .setDepth(9)
            .setAlpha(0);

        const falling = this.FALLING_PARTICLES.includes(state);
        if (falling) p.setPosition(head.x + Phaser.Math.Between(-14, 14), head.y + 30);
        this.tweens.add({
            targets: p,
            y: p.y + (falling ? Phaser.Math.Between(25, 35) : -Phaser.Math.Between(38, 55)),
            x: p.x + (state === "sleep" ? 18 * dir : Phaser.Math.Between(-18, 18)),
            angle: Phaser.Math.Between(-15, 15),
            duration: 1800,
            ease: "Sine.easeOut",
            onComplete: () => p.destroy(),
        });
        this.tweens.add({ targets: p, alpha: 1, duration: 250, yoyo: true, hold: 1100 });
    }

    // ---------- companion: cursor, computer awareness, focus, nudges, reminders, wardrobe ----------

    forEachAvatar(fn: (pet: Pet) => void): void {
        for (const pet of this.pets) if (pet && pet.isAvatar && pet.anims) fn(pet);
    }

    // a pet that isn't busy with anything
    isFree(pet: Pet): boolean {
        return !pet.activity && !pet.pendingActivity && pet.canPlayRandomState !== false && this.isOnGround(pet);
    }

    // look at the cursor when it's near; walk after it in follow mode
    updateLookAndFollow(): void {
        const mouse = this.inputManager.getMouse();
        if (mouse.x < 0) return;
        const recent = Date.now() - mouse.movedAt < 6000;

        this.forEachAvatar((pet) => {
            if (pet.activity || pet.pendingActivity || !this.isOnGround(pet)) return;
            const state = this.currentState(pet);
            const dx = mouse.x - pet.x;
            const head = this.headPoint(pet);
            const above = mouse.y < head.y - 30 && Math.abs(dx) < 160;

            if (pet.follow) {
                if (Math.abs(dx) > 80) {
                    this.setPetLookToTheLeft(pet, dx < 0);
                    if (state !== "walk") this.switchState(pet, "walk");
                    else this.updateDirection(pet, dx < 0 ? Direction.LEFT : Direction.RIGHT);
                } else {
                    this.setPetLookToTheLeft(pet, dx < 0);
                    this.switchState(pet, above ? "lookup" : "look");
                }
                return;
            }

            if (!["stand", "idle", "look", "lookup"].includes(state)) return;
            const near = Math.abs(dx) < 500 && mouse.y > pet.y - 500;
            if (recent && near) {
                if (Math.abs(dx) > 15) this.setPetLookToTheLeft(pet, dx < 0);
                const want = above ? "lookup" : "look";
                if (state !== want) this.switchState(pet, want);
            } else if (state === "look" || state === "lookup") {
                this.switchState(pet, "stand");
            }
        });
    }

    async pollSystem(): Promise<void> {
        try {
            this.status = await invoke<ISystemStatus>("get_system_status");
        } catch {
            this.status = null; // not available (e.g. not Windows): features stay quiet
            return;
        }
        const status = this.status;
        const p = this.personality();
        const now = this.time.now;

        // ---- away detection
        const away = p.awayAfter > 0 && status.idle_ms >= p.awayAfter * 60000;
        this.forEachAvatar((pet) => {
            if (away && !pet.awayMode && !(pet.mode && !pet.awayMode) && this.focus.phase !== "work") {
                if (pet.activity) this.endActivity(pet);
                this.startActivity(pet, "sleep", true, this.pick(this.LINES.away));
                pet.awayMode = true; // also when the nap is pending until it lands
            } else if (!away && pet.awayMode && status.idle_ms < 5000) {
                pet.pendingActivity = undefined;
                this.endActivity(pet);
                this.switchState(pet, "stand");
                this.showBubble(pet, this.pick(this.LINES.welcomeBack).replace("{time}", this.timeOfDay()));
                this.time.delayedCall(600, () => this.playReaction(pet, "greet"));
                pet.lastGreetAt = now;
                this.lastInteraction = now;
            }
        });
        if (away) return;

        // ---- app awareness: join in with what you're doing
        const app = status.app.toLowerCase();
        const own = app.includes("windowpet") || app.includes("window_pet");
        if (!own) {
            const title = status.title.toLowerCase();
            let match: string | null = null;
            for (const [state, patterns] of Object.entries(p.apps)) {
                if (patterns.some((pat) => {
                    const q = pat.toLowerCase();
                    return q.endsWith(".exe") ? app === q : title.includes(q) || app.includes(q);
                })) {
                    match = state;
                    break;
                }
            }
            if (match !== this.appCandidate.state) this.appCandidate = { state: match, since: now };
        }
        const target = this.appCandidate.state;
        const settled = now - this.appCandidate.since >= 5000;

        this.forEachAvatar((pet) => {
            // left the app it was joining in with
            if (pet.autoActivity && pet.activity !== target && settled) {
                this.endActivity(pet);
                this.switchState(pet, "stand");
                return;
            }
            if (!target || !settled || !this.isFree(pet)) return;
            if (now - (this.lastAutoAt[target] ?? -Infinity) < p.appCooldown * 60000) return;
            const lines = this.LINES[`auto${target[0].toUpperCase()}${target.slice(1)}`];
            if (this.startActivity(pet, target, false, lines ? this.pick(lines) : undefined)) {
                pet.autoActivity = true;
                this.lastAutoAt[target] = now;
            }
        });

        // ---- music: dance along, notice new songs
        const media = status.media;
        // videos (YouTube, Netflix…) also report as "playing": that's movie time, not music
        const watching = target === "movie" || this.pets.some((pet) => pet?.activity === "movie");
        if (p.music && media.playing && media.title && !watching) {
            const song = `${media.title}|${media.artist}`;
            const isNew = song !== this.lastSong;
            this.lastSong = song;
            this.forEachAvatar((pet) => {
                if (isNew) {
                    const name = media.title.length > 28 ? `${media.title.slice(0, 27)}…` : media.title;
                    this.showBubble(pet, `${this.pick(this.LINES.song)}\n♪ ${name}`, 3500);
                }
                if (!this.isFree(pet)) return;
                if (isNew || now >= this.nextVibeAt) {
                    this.playReaction(pet, "dance");
                    this.nextVibeAt = now + Phaser.Math.Between(18000, 32000);
                } else if (Math.random() < 0.5) {
                    this.spawnParticle(pet, "dance", this.PARTICLES.dance);
                }
            });
        }
    }

    // every second: focus timer, nudges, reminders
    tickCompanion(): void {
        const nowMs = Date.now();
        const p = this.personality();

        // ---- focus timer
        if (this.focus.phase) {
            const left = this.focus.endsAt - nowMs;
            if (left <= 0) this.focusPhaseDone();
            else {
                const icon = this.focus.phase === "work" ? "🍅" : "☕";
                this.forEachAvatar((pet) => this.setTimerPill(pet, `${icon} ${this.formatLeft()}`));
            }
        }

        // ---- wellbeing nudges (paused while you're away or in a focus block)
        const paused = (this.status && this.status.idle_ms > 60000) || this.focus.phase === "work";
        for (const [kind, minutes] of Object.entries(p.nudges)) {
            if (!minutes) continue;
            if (paused) {
                this.nudgeDue[kind] = (this.nudgeDue[kind] ?? nowMs) + 1000;
                continue;
            }
            if (!this.nudgeDue[kind]) this.nudgeDue[kind] = nowMs + minutes * 60000;
            if (nowMs >= this.nudgeDue[kind]) {
                this.nudgeDue[kind] = nowMs + minutes * 60000;
                this.deliver(this.pick(this.LINES[kind] ?? ["Take care of yourself 💖"]), 7000);
                break; // one nudge at a time
            }
        }

        // ---- reminders set in Settings
        const reminders = loadReminders();
        const due = reminders.filter((r) => r.at <= nowMs);
        if (due.length) {
            saveReminders(reminders.filter((r) => r.at > nowMs));
            due.forEach((r, k) => {
                const missed = nowMs - r.at > 120000 ? " (missed)" : "";
                this.time.delayedCall(k * 4000, () => this.deliver(`⏰ ${r.text}${missed}`, 15000, true));
            });
        }
    }

    // a pet says something important: hop to get noticed, then the message
    deliver(text: string, duration: number, urgent: boolean = false): void {
        this.forEachAvatar((pet) => {
            if (pet.awayMode && !urgent) return;
            if (pet.awayMode) {
                this.endActivity(pet);
                this.switchState(pet, "stand");
            }
            this.showBubble(pet, text, duration);
            if (this.isFree(pet)) this.playReaction(pet, urgent ? "attention" : "greet");
            if (urgent) this.spawnParticle(pet, "attention", { texts: ["⏰", "❗"], colors: ["#e8433f", "#ffb02e"] });
        });
    }

    formatLeft(): string {
        const left = Math.max(0, Math.round((this.focus.endsAt - Date.now()) / 1000));
        return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    }

    startFocus(): void {
        const f = this.personality().focus;
        this.focus.phase = "work";
        this.focus.endsAt = Date.now() + (f.work ?? 25) * 60000;
        this.forEachAvatar((pet) => {
            if (pet.activity) this.endActivity(pet);
            pet.follow = false;
            this.startActivity(pet, "laptop", true, `${this.pick(this.LINES.focusStart)} (${f.work} min)`);
        });
    }

    stopFocus(): void {
        this.focus.phase = null;
        this.forEachAvatar((pet) => {
            this.setTimerPill(pet, null);
            if (pet.mode && pet.activity === "laptop") this.endActivity(pet);
            this.switchState(pet, "stand");
            this.showBubble(pet, this.pick(this.LINES.focusStopped));
        });
    }

    focusPhaseDone(): void {
        const f = this.personality().focus;
        if (this.focus.phase === "work") {
            this.focus.sessions++;
            const long = f.longEvery && this.focus.sessions % f.longEvery === 0;
            const minutes = long ? f.longBreak ?? 15 : f.break ?? 5;
            this.focus.phase = "break";
            this.focus.endsAt = Date.now() + minutes * 60000;
            this.forEachAvatar((pet) => {
                if (pet.mode && pet.activity === "laptop") this.endActivity(pet);
                this.switchState(pet, "stand");
                this.showBubble(pet, `${this.pick(this.LINES.focusDone)} (${minutes} min) · 🍅×${this.focus.sessions}`, 6000);
                this.time.delayedCall(500, () => this.playReaction(pet, "dance"));
            });
        } else {
            if (f.autoNext) {
                this.startFocus();
                return;
            }
            this.focus.phase = null;
            this.forEachAvatar((pet) => {
                this.setTimerPill(pet, null);
                this.showBubble(pet, this.pick(this.LINES.breakOver), 6000);
                this.playReaction(pet, "attention");
            });
        }
    }

    // small dark pill with the focus countdown, shown above the head
    setTimerPill(pet: Pet, text: string | null): void {
        if (!text) {
            pet.timerPill?.destroy();
            pet.timerPill = null;
            return;
        }
        if (pet.timerPill) {
            const label = pet.timerPill.list[1] as Phaser.GameObjects.Text;
            if (label.text === text) return;
            label.setText(text);
            return;
        }
        const label = this.add
            .text(0, 0, text, {
                fontFamily: '"Segoe UI Emoji", "Segoe UI", sans-serif',
                fontSize: "12px",
                fontStyle: "bold",
                color: "#ffffff",
            })
            .setOrigin(0.5, 1)
            .setResolution(window.devicePixelRatio || 1);
        const w = 66, h = 20;
        const g = this.add.graphics();
        g.fillStyle(0x3b2f2f, 0.88);
        g.fillRoundedRect(-w / 2, -h, w, h, 10);
        label.setPosition(0, -3);
        pet.timerPill = this.add.container(0, 0, [g, label]).setDepth(10).setSize(w, h);
    }

    // rebuild avatar sprite sheets with the new outfit and react to it
    wardrobeChanged(): void {
        const outfit = effectiveWardrobe();
        // Settings both saves and sends an event: only rebuild once per change
        if (JSON.stringify(outfit) === JSON.stringify(this.lastOutfit)) return;
        const seen = new Set<string>();
        for (const sprite of this.configManager.getSpriteConfig()) {
            if (!sprite.avatar || seen.has(sprite.name)) continue;
            seen.add(sprite.name);
            const name = sprite.name;
            const users = this.pets.filter((pet) => pet && pet.texture?.key === name);
            const states = users.map((pet) => this.currentState(pet));

            for (const def of AVATAR_STATE_DEFS) this.anims.remove(`${def.state}-${name}`);
            if (this.textures.exists(name)) this.textures.remove(name);
            avatarMeta.delete(name);
            createAvatarTexture(this.textures, this.anims, name, { ...sprite.avatar, wardrobe: outfit });

            users.forEach((pet, k) => {
                pet.setTexture(name);
                pet.anims.play({ key: `${states[k] || "stand"}-${name}`, repeat: -1 });
            });
        }

        const item = describeNewItem(this.lastOutfit, outfit);
        this.lastOutfit = outfit;
        if (!item) return;
        this.forEachAvatar((pet) => {
            this.showBubble(pet, this.pick(this.LINES.newOutfit).replace("{item}", item), 3500);
            if (this.isOnGround(pet) && !pet.mode) {
                if (pet.activity) this.endActivity(pet);
                this.playReaction(pet, "spin", true);
            }
            this.spawnParticle(pet, "attention", { texts: ["✨", "💖", "⭐"], colors: ["#ff6b9a", "#ffb02e"] });
        });
    }
    private lastOutfit: IWardrobe = effectiveWardrobe();

    // ---------- keyboard shortcuts ----------

    async registerHotkeys(): Promise<void> {
        const avatar = this.configManager.getSpriteConfig().find((s) => s.avatar);
        if (!avatar) return;
        const hotkeys = this.personality({ personality: avatar.avatar?.personality } as Pet).hotkeys;

        for (const [action, accelerator] of Object.entries(hotkeys)) {
            if (!accelerator) continue;
            try {
                if (await isRegistered(accelerator)) await unregister(accelerator);
                await register(accelerator, () => this.onHotkey(action));
                this.registeredHotkeys.push(accelerator);
            } catch (err: any) {
                error(`Could not register shortcut ${accelerator} for ${action}: ${err}`);
            }
        }
        info(`Avatar shortcuts: ${Object.entries(hotkeys).map(([a, k]) => `${k} = ${a}`).join(", ")}`);
    }

    unregisterHotkeys(): void {
        for (const accelerator of this.registeredHotkeys) {
            unregister(accelerator).catch(() => {});
        }
        this.registeredHotkeys = [];
    }

    onHotkey(action: string): void {
        this.lastInteraction = this.time.now;
        if (action === "focus") {
            this.focus.phase ? this.stopFocus() : this.startFocus();
            return;
        }
        if (action === "follow") {
            this.forEachAvatar((pet) => {
                pet.follow = !pet.follow;
                this.showBubble(pet, this.pick(pet.follow ? this.LINES.followOn : this.LINES.followOff));
                if (!pet.follow && this.currentState(pet) === "walk") this.switchState(pet, "stand");
            });
            return;
        }
        for (const pet of this.pets) {
            if (!pet || !pet.isAvatar || !pet.anims) continue;

            if (action === "normal") {
                pet.pendingActivity = undefined;
                if (pet.activity) {
                    this.endActivity(pet);
                    this.showBubble(pet, this.pick(this.LINES.modeOff));
                    this.switchState(pet, "stand");
                }
                continue;
            }

            if (this.MODES[action]) {
                // same shortcut again turns the mode off
                if (pet.mode && pet.activity === action) {
                    this.endActivity(pet);
                    this.showBubble(pet, this.pick(this.LINES.modeOff));
                    this.switchState(pet, "stand");
                    continue;
                }
                if (pet.activity) this.endActivity(pet);
                this.startActivity(pet, action, true);
                continue;
            }

            // one-off actions (greet, dance, spin...)
            if (pet.activity) this.endActivity(pet);
            this.playReaction(pet, action, true);
        }
    }

    // bubbles that go with a state change
    showEmoteForState(pet: Pet, state: string): void {
        if (!pet.isAvatar) return;
        if (this.NOT_ON_GROUND_STATES.includes(state)) {
            this.clearBubble(pet);
            return;
        }
        if (state === "greet") {
            const line = this.pick(this.personality(pet).greetings);
            this.showBubble(pet, line.replace("{time}", this.timeOfDay()));
        } else if (state === "spin" && Math.random() < 0.6) {
            this.showBubble(pet, this.pick(this.LINES.spin));
        } else if (state === "dance" && Math.random() < 0.4) {
            this.showBubble(pet, this.pick(this.LINES.dance));
        }
    }
}
