# ToonTalk Studio — Viral 9:16 Two-Character Video Maker

ToonTalk Studio turns any short idea into a ready-to-post 1080×1920 vertical "two characters talking" video (inspired by viral Minecraft/Roblox dialogue shorts). Users pick or upload a background video and two character cutouts, enter a prompt, customize AI-generated scripts, voices, framing, and animated captions, and export a burned-in vertical video with mixed audio directly to their Android device.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following product decisions were confirmed during our initial review and are built directly into this plan:

- **Confirmed Decision 1 — Built-in Starter Assets + Custom Uploads**: The app includes a built-in starter parkour/gameplay loop video and two transparent character PNG cutouts (Character A & Character B) for instant one-tap testing, alongside full support for uploading custom background videos and transparent PNGs.
- **Confirmed Decision 2 — Granular Line & Voice Control**: Users can edit text, regenerate individual dialogue lines or the entire script, and preview or regenerate individual line voice clips independently.
- **Confirmed Decision 3 — Direct Android Gallery Save & Native Sharing**: Finished 1080×1920 videos can be previewed in-app, saved directly to the Android `Movies` / Gallery folder via `MediaStore`, and shared to social apps via the system Share sheet.
- **AI Provisioning & Optional Custom Key**: The app uses **Firebase AI Logic** (`gemini-3.8-flash` for structured script generation and `gemini-3.1-flash-tts-preview` for speech generation), and also includes an optional local Gemini API key override in the Settings modal (stored locally on-device and never hardcoded) to support standalone Capacitor/APK builds.

---

## 1. Overview & Core Concept

- **What It Does**: Guides creators through a 5-stage visual wizard to produce vertical 1080×1920 short-form dialogue videos featuring two animated character cutouts reacting to each other over a gameplay or aesthetic background video, complete with audio-reactive bounce animations and word-by-word dynamic captions.
- **Target Audience / Persona**: Short-form content creators (TikTok, YouTube Shorts, Instagram Reels), meme pages, and educators who want fast, high-retention dialogue videos on mobile without desktop editing software.
- **Key Value**: Automates scriptwriting, dual-voice TTS synthesis, audio-reactive character animation, dynamic word-level captioning, and 9:16 background framing in a single on-device workflow.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Step 1 — Assets & Characters (Pill 1/5)**:
   - Choose the built-in starter pack with one tap or upload a custom background video (any aspect ratio) and two transparent character PNGs.
   - Character A is positioned on the **Left** (confident persona) and Character B on the **Right** (silly/reacting persona).
   - Customize Character A and Character B display names (defaults: `"A"` and `"B"`) and signature badge colors.
2. **Step 2 — Idea, Genre, Language & Length (Pill 2/5)**:
   - Enter a short topic or prompt (e.g., *"octopus"*, *"life of a student"*).
   - Select from 8 big tappable Script Type cards that wobble playfully when selected: **Funny Facts**, **Story**, **Debate / Argument**, **Roast Battle**, **Quiz**, **Motivational**, **Horror / Mystery**, or **Custom** (reveals a custom style input field).
   - Pick the dialogue **Language** (**English**, **Roman Urdu**, or **Hindi**) and target **Video Length** (**15s**, **30s**, **45s**, or **60s**).
3. **Step 3 — Editable Script Studio (Pill 3/5)**:
   - Gemini generates an alternating JSON dialogue array (`[{"speaker":"A","text":"..."}, ...]`) with a maximum of 20 words per line, a punchy hook in the first line, and a punchline or comment-bait question in the final line.
   - Each line appears in a cartoon-outlined editable card with speaker toggle, word-count badge, per-line **Regenerate** button, add/delete line controls, a full-script **Regenerate** button, and a **Next** button.
4. **Step 4 — Voices & Audio Timeline (Pill 4/5)**:
   - Assign distinct prebuilt voices for Character A and Character B (e.g., *Puck*, *Charon*, *Kore*, *Fenrir*, *Aoede*) with instant **Preview Voice** buttons.
   - Synthesize one audio clip per dialogue line and inspect individual clip durations. Users can replay or regenerate any single line's audio clip.
   - Displays total calculated video duration: $\sum \text{Clip Durations} + 0.15\text{s} \times (\text{Lines} - 1)$.
5. **Step 5 — Studio Preview, Framing, Captions & Render (Pill 5/5)**:
   - Interactive live 9:16 canvas preview with three tabbed customization drawers:
     - **Background Framing**: *Fill* (center-crop to cover 1080×1920, default), *Fit + Blur* (full uncropped video centered over a scaled blurred copy), or *Custom* (zoom 100%–200% + X/Y pan sliders). Includes segment start rule (*Start from 0:00* or *Random Start Segment*) when the background video exceeds dialogue duration, and automatic seamless looping when shorter.
     - **Characters & Motion**: Positioned around vertical center (50% height default), each ~40% frame width. Active character slides in from their screen edge with a 0.25s pop/bounce and scales rhythmically to real-time voice loudness. Includes toggle between *"Hide silent character"* (default) and *"Dim and shrink the silent character"*, plus sliders for **Character Size**, **Vertical Position**, and **Edge Distance**.
     - **Captions Engine**: Master ON/OFF toggle (default ON), 7 tappable template cards with live preview (**Classic Yellow**, **Pop Bounce**, **Neon Glow**, **Minimal Clean**, **Boxed**, **Karaoke**, **Comic**), 5 bold language-aware fonts (including Devanagari/Urdu support), font size slider, vertical zone selector (*Top / Center / Bottom Third* default), words per screen (*1, 2, 3, or 4*), highlight color picker, outline thickness slider, and *"Show speaker name tag"* toggle.
   - **Render & Export**: Tapping **Create Video** mixes the dialogue audio tracks and background video audio (adjustable volume slider, default 10%) while recording the 1080×1920 canvas. Displays a thick pink progress bar with a bouncing mascot and estimated remaining time, followed by a confetti burst, video playback preview, **Save to Gallery / Download**, **Share**, and **Make Another** (retaining uploaded assets and saved preferences).

### Visual Identity & Theme (2D Cartoon Sticker-Game Style)

- **Aesthetic Direction**: Flat 2D casual mobile sticker-game interface—zero realistic gradients, zero glassmorphism. Every card, input, badge, and button features crisp **3px solid black outlines (`#1B1B1B`)** and rounded corners (`14dp–18dp`).
- **Color Palette & Mood**:
  - **Sky Blue Canvas Background**: `#BFE9FF` with subtle cartoon cloud/dot pattern
  - **Sunny Yellow (Primary / Active Step / Highlights)**: `#FFD93B`
  - **Candy Pink (Progress Fill / Accent CTA)**: `#FF7AA8`
  - **Slime Green (Success / Create CTA)**: `#3DDC6A`
  - **Tangy Orange (Character A / Secondary Cards)**: `#FF9A5C`
  - **Lavender Purple (Character B / Voice Cards)**: `#B79CFF`
  - **Ink Outline & Typography**: `#1B1B1B` on Crisp White (`#FFFFFF`) card surfaces
- **Typography & Hierarchy**:
  - Bundled bold rounded cartoon display and UI fonts (**Fredoka**, **Baloo 2**, **Bubblegum Sans**, **Bangers**, and **Poppins** / Devanagari-ready **Baloo 2**) installed locally for both the app UI and the canvas caption renderer.
- **Interactive Feedback & Motion**:
  - **Chunky Key Buttons**: 3px top/side borders with a thick 6–7px bottom border; pressing translates the button down by `3px` and triggers a synthesized Web Audio / SoundGenerator "pop" sound effect.
  - **Wobble & Bounce**: Selected Script Type cards perform a playful rotation wobble; loading states display a bouncing mascot with rotating funny status messages; rendering completion triggers a canvas confetti burst.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Dual-Engine Hybrid Architecture (Compose Shell + Hardware-Accelerated Web/Canvas Media Engine & Native Android Export Bridge)**:
  - *Chosen Approach*: Provide the complete 2D cartoon wizard experience with full HTML5 Canvas 1080×1920 rendering, Web Audio `AnalyserNode` loudness tracking, `MediaStreamAudioDestinationNode` mixing, and `MediaRecorder` / MP4 muxing bridged directly to Android's native `MediaStore` Gallery saver, Photo/Video picker, and Share sheet, while integrating Firebase AI Logic (`gemini-3.8-flash` & `gemini-3.1-flash-tts-preview`) and optional local API key overrides.
  - *Why*: Directly fulfills every technical requirement in the prompt (1080×1920 Canvas composition, `AnalyserNode` bounce sync, `MediaStreamAudioDestinationNode` background + voice mixing, 7 burned-in caption templates, `localStorage` persistence, and Capacitor-ready web structure) while running natively inside the Android APK with real Gallery export and Firebase AI Logic attestation.
  - *Alternatives Considered*: Pure OpenGL shader encoding without Canvas was passed over because rich 2D text styling (multi-pass strokes, neon shadows, karaoke word clipping, and comic bounding boxes) is significantly more flexible and Capacitor-portable on a 2D Canvas pipeline.
- **Decision 2 — Persistent User Preferences & Asset Continuity**:
  - *Chosen Approach*: Automatically persist template choices, voice assignments, character positions, caption styles, background volume (default 10%), and optional custom API key in local storage (`localStorage` / `SharedPreferences`), while keeping uploaded video and character PNGs in memory when clicking **"Make Another"**.
  - *Why*: Lets creators produce batches of shorts in a consistent visual style without re-configuring settings or re-uploading character PNGs between videos.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     MainActivity (Android APK Host)                        │
│  • Firebase App Check Init (configureAppCheck with launch intent)          │
│  • Native Android Bridge (Gemini AI Logic, MediaStore Save, Share Sheet)   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│             ToonTalk Studio 2D Cartoon UI & Wizard Controller              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Step 1   │→ │ Step 2   │→ │ Step 3   │→ │ Step 4   │→ │ Step 5       │  │
│  │ Assets   │  │ Idea &   │  │ Script   │  │ Voices & │  │ Framing,     │  │
│  │ & Names  │  │ Genre    │  │ Editor   │  │ Clips    │  │ Captions &   │  │
│  │          │  │          │  │          │  │          │  │ Render       │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
└───────┼─────────────┼─────────────┼─────────────┼───────────────┼──────────┘
        │             │             │             │               │
        ▼             ▼             ▼             ▼               ▼
┌───────────────────────────┐ ┌─────────────────────────┐ ┌──────────────────┐
│   Asset & Preset Store    │ │   Gemini AI Service     │ │ 1080x1920 Render │
│ • Starter Video Generator │ │ • Script Generator      │ │ & Audio Engine   │
│ • Starter Character A/B   │ │   (gemini-3.8-flash     │ │ • Background Fit │
│ • Custom Video/PNG Loader │ │    JSON Schema)         │ │   (Fill/Blur/Pan)│
│ • LocalStorage Settings   │ │ • TTS Voice Synthesizer │ │ • AnalyserNode   │
│   (Voices, Layout, Style) │ │   (gemini-3.1-flash-tts │ │   Talking Bounce │
│                           │ │    + AudioBuffer Cache) │ │ • 7 Caption      │
│                           │ │ • Custom API Key Option │ │   Renderers      │
└───────────────────────────┘ └─────────────────────────┘ └────────┬─────────┘
                                                                   │
                                                                   ▼
                                                   ┌─────────────────────────┐
                                                   │ MediaRecorder + Android │
                                                   │ MediaStore MP4/WebM     │
                                                   │ Gallery & Share Export  │
                                                   └─────────────────────────┘
```

### Data Model & State

- **`ProjectAssets`**:
  - `backgroundVideoUrl` (Blob URL or procedural starter parkour video stream), `videoDuration`, `videoWidth`, `videoHeight`
  - `charAImage` & `charBImage` (Transparent PNG `ImageBitmap` / `HTMLImageElement`, defaulting to built-in cartoon characters)
  - `charAName` (default `"A"`), `charBName` (default `"B"`), `charAColor` (`#FF9A5C`), `charBColor` (`#B79CFF`)
- **`ScriptConfig & DialogueLine`**:
  - `idea` (String), `scriptType` (`Funny Facts`, `Story`, `Debate / Argument`, `Roast Battle`, `Quiz`, `Motivational`, `Horror / Mystery`, `Custom`), `customStyle` (String)
  - `language` (`English`, `Roman Urdu`, `Hindi`), `targetLengthSec` (`15`, `30`, `45`, `60`)
  - `lines`: List of `{ id, speaker: "A" | "B", text: String, audioBuffer: AudioBuffer?, durationSec: Float, status: Idle | Loading | Ready | Error }`
- **`VoiceSettings`**:
  - `voiceA` (default `"Puck"` — confident/energetic), `voiceB` (default `"Kore"` / `"Fenrir"` — reactive/expressive)
  - `gapBetweenLinesSec`: `0.15s` fixed inter-line pause
  - `bgMusicVolume`: `0.0` to `1.0` (default `0.10` / 10%)
- **`SceneAndCaptionSettings`** (persisted in `localStorage`):
  - **Framing**: `fitMode` (`fill` | `fit_blur` | `custom`), `customZoom` (`100%–200%`), `customPanX` (`-100%` to `+100%`), `customPanY` (`-100%` to `+100%`), `trimStartMode` (`zero` | `random`)
  - **Characters**: `silentMode` (`hide` | `dim_shrink`), `charScale` (`0.5`–`1.5`, default `1.0` = 40% width), `charVerticalPos` (`20%`–`80%`, default `50%`), `charEdgeOffset` (`0%`–`25%`, default `5%`)
  - **Captions**: `enabled` (Boolean, default `true`), `template` (`classic_yellow`, `pop_bounce`, `neon_glow`, `minimal_clean`, `boxed`, `karaoke`, `comic`), `fontFamily` (`Fredoka`, `Baloo 2`, `Bubblegum Sans`, `Bangers`, `Poppins`), `fontSize` (`36px`–`96px`), `position` (`top`, `center`, `bottom` default), `wordsPerScreen` (`1`, `2`, `3`, `4`), `highlightColor` (hex string), `outlineThickness` (`0px`–`14px`), `showSpeakerTag` (Boolean)

### Interactive Component & State Mapping

- **Step Navigation & Validation**: The 5-segment top pill indicator tracks wizard progress and allows jumping back to any completed step. Each step validates required inputs (e.g., non-empty idea in Step 2, at least 1 script line in Step 3, generated audio buffers in Step 4) with friendly cartoon error banners and a **Retry** button on failure.
- **Script Generation & Per-Line Editing**:
  - Full-script generation sends `idea + scriptType + language + targetLengthSec` to Gemini with a strict JSON schema enforcing alternating `"A"` and `"B"` speakers and $\le 20$ words per line.
  - Per-line regeneration sends the surrounding dialogue context to rewrite just the selected line while keeping the joke/story flow intact. Editing a line marks its corresponding `AudioBuffer` as needing refresh in Step 4.
- **Voice Synthesis & Preview**:
  - Uses Gemini TTS (`gemini-3.1-flash-tts-preview`) via the native bridge / REST endpoint (when custom key is supplied) to synthesize 24kHz mono PCM audio, converts it into a Web Audio `AudioBuffer`, and caches it per line ID.
  - Provides instant voice sample previews and single-line audio regeneration.
- **1080×1920 Canvas Compositor & Audio Mixer**:
  - Runs at 30/60 FPS on an internal `1080×1920` canvas.
  - **Background Layer**: Renders the video element using exact crop/scale math for *Fill*, dual-pass `ctx.filter = 'blur(28px)'` + centered frame for *Fit + Blur*, or user zoom/pan offsets for *Custom*. Handles seamless looping or random start offset trimming.
  - **Character Layer**: Evaluates current timeline timestamp $t$ against cumulative line intervals $[t_{\text{start}}, t_{\text{end}}]$. Computes a 0.25s ease-out back-spring slide-in from the left/right edge at line start, samples real-time frequency/time-domain amplitude from `AnalyserNode` to apply a talking scale bounce ($1.0 + 0.08 \times \text{rms}$), and either hides or dims/shrinks ($0.75\times$ scale, $45\%$ opacity) the silent character.
  - **Caption Layer**: Partitions each line's words into chunks of size `wordsPerScreen` timed evenly across the line's duration, rendering the active template (e.g., multi-stroke outline for *Classic Yellow*, spring scale for *Pop Bounce*, `shadowBlur` for *Neon Glow*, rounded pill background for *Boxed*, progressive horizontal clip fill for *Karaoke*, and angled comic badge for *Comic*) plus optional colored speaker name tag.
  - **Recording & Export**: Connects the background video source gain node (default 10%) and active dialogue `AudioBufferSourceNode` (routed through `AnalyserNode`) into a shared `MediaStreamAudioDestinationNode`. Combines the audio track with `canvas.captureStream(30)` into `MediaRecorder` (preferring `video/mp4;codecs=avc1,mp4a.40.2` where supported, with automatic fallback to `video/webm;codecs=vp9,opus`), and pipes the recorded binary directly to the Android `MediaStore` (`Movies/ToonTalk`) for Gallery saving and native sharing.
