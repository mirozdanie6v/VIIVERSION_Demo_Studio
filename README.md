# VIIVERSION Demo Studio

Automatic presentation-video generation for web applications.

## Current flow

`scenario.json → autonomous browser walkthrough → presentation camera → recorded video + timeline metadata`

The runner can navigate the product, find UI by semantic selectors, fill forms, click, wait for UI/navigation, assert expected states and automatically emphasize the active interface element while recording.

## Quick start

```bash
npm install
npx playwright install chromium
npm run capture -- --scenario examples/viiversion-v1.json
```

Output:

```text
artifacts/<run-id>/
├── capture.webm
└── run.json
```

## Scenario Engine v1

```json
{
  "name": "Product demo",
  "baseUrl": "https://demo.viiversion.com",
  "variables": {
    "product": "Premium Tour"
  },
  "presentation": {
    "smartZoom": {
      "scale": 1.14,
      "mobileScale": 1.04
    },
    "focusRing": {
      "enabled": true
    },
    "clickRipple": {
      "enabled": true
    }
  },
  "steps": [
    { "action": "goto", "url": "/catalog" },
    {
      "action": "click",
      "target": { "by": "text", "value": "{{var.product}}", "exact": true }
    },
    {
      "action": "waitFor",
      "target": { "by": "role", "value": "heading", "name": "{{var.product}}" }
    },
    {
      "action": "assert",
      "target": { "by": "testId", "value": "booking-form" },
      "assertion": "visible"
    }
  ]
}
```

### Presentation Motion

For targeted actions the camera now:

1. smoothly centers the active element;
2. calculates its on-screen geometry;
3. applies adaptive zoom around the element;
4. moves the presentation cursor to it;
5. shows a configurable focus ring;
6. adds click ripple feedback;
7. returns safely to the normal view before the next scene.

Desktop and mobile use separate zoom defaults. Each camera frame is also written into `run.json`, so the later renderer can reuse exact element geometry for post-production zooms.

Configuration:

- `presentation.enabled`
- `presentation.smartZoom.scale`
- `presentation.smartZoom.mobileScale`
- `presentation.smartZoom.transitionMs`
- `presentation.smartZoom.settleMs`
- `presentation.cursor.*`
- `presentation.focusRing.*`
- `presentation.clickRipple.*`

### Targets

Preferred selectors:

- `role` — semantic UI controls and headings
- `text` — visible text
- `testId` — stable product selectors
- `css` — fallback for custom UI
- plain string — legacy Playwright selector compatibility

### Variables and secrets

Scenario variables:

```text
{{var.product}}
```

Environment-backed secrets:

```text
{{env.DEMO_LOGIN}}
{{env.DEMO_PASSWORD}}
```

Secrets remain outside the scenario file.

### Supported actions

- `goto`
- `click`
- `fill`
- `hover`
- `press`
- `scroll`
- `wait`
- `waitFor`
- `waitForNavigation`
- `assert`

Assertions: `visible`, `hidden`, `textContains`, `valueEquals`.

## AI Director

Generate an executable scenario from a URL and a plain-language goal:

```bash
OPENAI_API_KEY=... npm run direct -- \
  --url https://app.example.com \
  --goal "Show the catalog, open an item and demonstrate the request flow"
```

AI Director:

1. opens and inspects the application;
2. collects visible interactive UI and stable targets;
3. sends the goal plus UI snapshot to the OpenAI Responses API;
4. requests a structured scenario;
5. validates the generated scenario through Scenario Engine;
6. writes both `demo-scenario.json` and a readable `demo-scenario.storyboard.md`.

Set `OPENAI_DIRECTOR_MODEL` to override the default planning model.

## Final MP4 render

After capture:

```bash
npm run render -- --run artifacts/<run-id> --preset 16:9
```

Export presets:

- `16:9` → 1920×1080
- `9:16` → 1080×1920
- `1:1` → 1080×1080

The renderer currently supports:

- H.264 MP4 output;
- burned-in captions generated from `narration` / `label`;
- VIIVERSION branding and optional CTA;
- optional existing voiceover audio;
- optional looping background music;
- automatic music ducking under narration;
- AI voiceover generation through OpenAI Text-to-Speech when `--tts` is used.

Example with AI voiceover:

```bash
OPENAI_API_KEY=... npm run render -- \
  --run artifacts/<run-id> \
  --preset 9:16 \
  --tts \
  --voice marin \
  --cta "Book your demo"
```

For narration, add `narration` to the relevant scenario steps. FFmpeg must be available as `ffmpeg` or through `FFMPEG_PATH`.

## Product architecture

- **Scenario Engine** — deterministic and validated demo workflow.
- **Browser Runner** — autonomous Playwright execution.
- **Capture Layer** — browser-session recording.
- **Presentation Motion** — smart zoom/focus/click emphasis.
- **Render Layer** — MP4, captions, voiceover, music and branding.
- **AI Director** — natural-language goal → executable demo scenario.
- **Plugin/API Layer** — ChatGPT and external integrations.


## Runtime recovery

Interactive targets use semantic recovery when a previously valid selector changes. The runner first tries the exact target, then safe fallbacks such as relaxed role/name matching, visible text, and common test-id attributes. Any recovery is recorded in `run.json`.

## Scene-aware rendering

The renderer derives meaningful scenes from the capture timeline, removes passive dead time, writes the edit plan to `scenes.json`, remaps subtitle timing to the edited timeline, and renders branded intro/outro cards.

Useful render controls:

```bash
npm run render -- \
  --run artifacts/<run-id> \
  --preset 16:9 \
  --title "Product walkthrough" \
  --cta "Book a demo"
```

Use `--no-intro`, `--no-outro`, or `--no-captions` when a clean raw export is needed.

## Service / plugin surface

`npm run serve` starts the authenticated REST + MCP service.

- REST jobs: `POST /v1/jobs`
- job status: `GET /v1/jobs/{jobId}`
- MP4 artifact: `GET /v1/jobs/{jobId}/artifact`
- OpenAPI: `GET /openapi.json`
- MCP Streamable HTTP: `/mcp`

Production deployments should use the Docker image, a real `DEMO_STUDIO_API_KEY`, public Host/Origin allowlists, and `ALLOW_PRIVATE_TARGETS=false`.


## Editor Brain v0.11

The production renderer now uses the VIIVERSION editorial pipeline rather than direct timeline trimming:

```
Capture → Semantic Timeline → Editor Brain → Critic → Music Brain → Subtitle Brain → FFmpeg
```

Editor Brain ports the semantic-v5 editorial model from `mirozdanie6v/EventVideoHumanEditor`: scene type, shot intent, importance, continuity, story note, edit strategy and a quality gate.

Each render writes inspectable editorial artifacts:

- `editor_brain.json`
- `editor_critic.json`
- `music_brain.json`
- `captions.json`
- `scenes.json`

For music-aware cuts, pass a known BPM:

```bash
npm run render -- --run artifacts/<run-id> --music track.mp3 --music-bpm 120
```

See `docs/EDITOR_BRAIN_REUSE.md` for the reuse map.


## UX / Design Brain v0.12

Demo Studio now reuses the VIIVERSION UX/UI quality stack from Mini App Factory and KP Universal Proposal Orchestrator.

```
URL → UX preflight → Design Profile → Design Contract
    → Capture → Editor Brain → Presentation Design Brain
    → Visual Critic → FFmpeg
```

Run a standalone audit:

```bash
npm run ux-audit -- --url https://example.com --out artifacts/ux-audit
```

The audit produces desktop/mobile screenshots, browser QA, an inferred design profile and an overlay design contract.

During rendering, the Presentation Design Brain uses recorded active-element camera geometry to move captions and branding away from important UI. The independent Visual Critic returns PASS, REVISE or BLOCKED with a bounded revision loop.

See `docs/UX_DESIGN_BRAIN_REUSE.md` for the verified reuse map.


## Multilingual Voice Engine

Demo Studio now routes narration through a provider-agnostic Voice Engine:

```text
locale + persona → Voice Director → pronunciation → TTS Router
                → Hugging Face local / ElevenLabs / OpenAI / Piper fallback
                → audio + timing metadata
```

The default `viiversion-presenter` persona is stable across languages while the actual native voice may vary by locale.

Scenario example:

```json
{
  "voice": {
    "locale": "ja-JP",
    "provider": "auto",
    "persona": "viiversion-presenter",
    "requireNativeTimings": true
  }
}
```

Standalone routing/synthesis:

```bash
npm run voice -- --locale ja-JP --text "..." --out /tmp/demo.mp3 --provider auto
```

See `docs/VOICE_ENGINE.md` for provider setup, locale-specific voices, pronunciation rules and fallback behavior.

### Free local voice generation

Demo Studio can synthesize narration locally from open-weight Hugging Face models without a paid TTS API:

```bash
python3 -m pip install -r requirements-tts.txt

HF_TTS_ENABLED=1 \
HF_TTS_ENGINE=auto \
npm run voice -- --locale vi-VN --text "Xin chào" --out /tmp/voice.mp3 --provider huggingface
```

The approved free presenter voice is **Chatterbox Multilingual V3**. Install `requirements-tts-chatterbox.txt` on presentation-quality workers; `auto` prefers Chatterbox for supported locales and falls back to Supertonic where needed.


## Transparent job progress and recovery

Demo Studio v0.13 exposes every long-running generation as a live, durable job.

A generation response includes both the JSON status endpoint and a browser progress page:

```
/v1/jobs/{job-id}
/jobs/{job-id}
```

The progress view shows the current stage, percentage, attempt count, heartbeat, elapsed stage time, retry reason and recent activity.

Transient errors retry automatically. A Cloudflare Durable Object watchdog monitors stage timeouts; if a generation stops progressing it destroys the stalled container, starts a clean container and resumes the same job ID from a private recovery record. Recovery is bounded to prevent infinite restart loops.

See `docs/JOB_RELIABILITY.md` for the recovery model and stage timeouts.
