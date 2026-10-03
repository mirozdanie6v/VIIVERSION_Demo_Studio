# Attention Director

## Purpose

Demo Studio must edit product demos as a guided path of human attention, not as a screen recording with decorative zooms.

## Core perception model

For each UI state, the edit follows:

1. **Establish** — show the whole interface long enough to understand context.
2. **Orient** — let the viewer identify the dominant hierarchy.
3. **Focus** — move attention to the semantic block currently being discussed.
4. **Act** — emphasize the control the customer is about to use.
5. **Release** — return enough context before moving to the next state.

A zoom is allowed only when it represents a real shift of attention.

## Composition rules

- Never zoom merely to create motion.
- Never crop important words, prices, buttons, photos, form labels or navigation required to understand the current state.
- Preserve enough surrounding UI to explain where the focused block lives.
- Prefer moderate semantic push-ins, normally 1.10–1.25x.
- Use stronger framing only when the focused component still remains complete.
- Before a new screen is examined, show its full state for roughly 1–2 seconds unless the action itself supplies context.
- Reframe toward the semantic target, not toward geometric center.
- Treat target rectangles from captured interactions as evidence, not as an automatic crop command.
- Use visual hierarchy, safe margins and balanced negative space when deciding the focal center.

## Attention continuity

Narration and picture must describe the same thought at the same moment.

Examples:

- narration introduces a page → full page;
- narration discusses the hero proposition → focus hero text;
- narration discusses choice → focus the relevant cards;
- narration prepares an action → focus the button without losing its label/context;
- narration discusses AI response → show the response region, not the input;
- narration moves to business value → release toward the overall completed experience.

## Device presentation

For vertical client-facing product demos:

- show mobile UI inside a premium smartphone frame rather than as a floating rectangle;
- use restrained bezel, rounded screen corners, soft external shadow and subtle hardware detail;
- never let the device treatment reduce UI contrast;
- keep the device stationary unless movement has narrative meaning.

## Subtitle accessibility

- subtitles live in a dedicated dark rail above the device, never over product UI;
- target size for 1080×1920: approximately 46–52 px bold depending on font metrics;
- maximum two visual lines per cue;
- maintain generous horizontal padding;
- line wrapping must be checked at final output resolution;
- readability from a phone screen takes priority over fitting a long sentence on one line.

## QA gate

Reject a render if any of the following are true:

- a semantic zoom cuts required UI information;
- the zoom target is unrelated to current narration/action;
- movement exists only because a scene is static;
- subtitles touch or cross the rail boundary;
- subtitle text is difficult to read on a phone-sized preview;
- the mobile capture looks like an unframed shrunken webpage rather than a designed device presentation.

Reference implementation used for MAX TOUR: establish → focus block → action → release attention path with moderate 1.10–1.23x semantic push-ins.
