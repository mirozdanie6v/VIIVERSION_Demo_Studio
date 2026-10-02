# VIIVERSION Demo Studio

Automatic presentation-video generation for web applications.

## Current flow

`scenario.json → Playwright runner → recorded browser walkthrough + timeline metadata`

The runner can already navigate the product, find UI by semantic selectors, fill forms, click, wait for UI/navigation, assert expected states and record the complete session.

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

## Product architecture

- **Scenario Engine** — deterministic and validated demo workflow.
- **Browser Runner** — autonomous Playwright execution.
- **Capture Layer** — browser-session recording.
- **Presentation Motion** — smart zoom/focus/click emphasis.
- **Render Layer** — MP4, captions, voiceover, music and branding.
- **AI Director** — natural-language goal → executable demo scenario.
- **Plugin/API Layer** — ChatGPT and external integrations.
