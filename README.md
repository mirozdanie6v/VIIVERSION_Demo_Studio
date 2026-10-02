# VIIVERSION Demo Studio

Generate presentation videos of web applications from a URL and a reproducible interaction scenario.

## MVP

The first working core uses Playwright to:

1. open a web application;
2. execute a typed sequence of actions;
3. record the browser session as video;
4. save run metadata for later rendering.

The next layers will add smart zoom, click emphasis, captions, voiceover, music, VIIVERSION branding and MP4 rendering.

## Quick start

```bash
npm install
npx playwright install chromium
npm run capture -- --scenario examples/basic.json
```

The recorded video is written to `artifacts/<run-id>/`.

## Scenario format

```json
{
  "name": "Product demo",
  "viewport": { "width": 1440, "height": 900 },
  "steps": [
    { "action": "goto", "url": "https://example.com" },
    { "action": "wait", "ms": 1000 },
    { "action": "click", "selector": "text=Learn more" }
  ]
}
```

Supported MVP actions: `goto`, `click`, `fill`, `hover`, `press`, `scroll`, `wait`.

## Product architecture

- **Scenario Engine** — deterministic demo workflow.
- **Browser Runner** — autonomous Playwright execution.
- **Capture Layer** — browser-session recording.
- **Render Layer** — upcoming presentation-grade composition.
- **Plugin/API Layer** — upcoming ChatGPT and external integrations.
