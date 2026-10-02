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
