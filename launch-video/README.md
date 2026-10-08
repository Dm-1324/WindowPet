# WindowPet launch video

A 45-second 1080p launch video made with [Remotion](https://www.remotion.dev) (videos written in React).
The pet in the video uses the app's real animations: they are generated from `../src/scenes/avatar.ts`.

## Make / edit the video

```bash
cd launch-video
npm install
npm run export-frames   # renders the avatar's animation frames into public/frames
npm run dev             # opens Remotion Studio in the browser: preview, scrub, tweak
npm run render          # writes out/windowpet-launch.mp4
```

Requirements: Node.js 16+ on Windows x64, macOS 15+ or Linux. Remotion downloads its own headless Chrome on first render.

## Where things are

| File | What |
|---|---|
| `src/Video.tsx` | Scene order and lengths (30 fps) |
| `src/scenes.tsx` | The 8 scenes: intro, one picture, personality, app awareness, pet & feed, wardrobe, useful, end card |
| `src/components.tsx` | Sprite (plays an avatar animation), taskbar, speech bubble, pills, floating emoji, cursor, app window |
| `src/theme.ts` | Colours and fonts (Inter, bundled in `public/fonts`, OFL licensed) |
| `scripts/export-frames.cjs` | Exports animation frames and outfit variants from the app's generator |

To add music, put an MP3 in `public/` and add `<Audio src={staticFile("music.mp3")} />` inside `WindowPetLaunch` in `src/Video.tsx`.
To use your own screen recordings, put an MP4 in `public/` and show it with `<OffthreadVideo src={staticFile("clip.mp4")} />` in a scene.

## License note

Remotion is free for individuals, companies with up to 3 employees, non-profits and evaluation;
larger companies need a [company license](https://www.remotion.pro/license).
