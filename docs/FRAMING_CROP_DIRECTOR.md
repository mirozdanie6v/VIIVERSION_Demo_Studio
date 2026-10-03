# Framing & Crop Director

## Purpose

Cropping in Demo Studio is an editorial composition decision. It is never a mechanical zoom around a click coordinate.

The crop must answer two questions:

1. What must the viewer look at right now?
2. What surrounding context must remain visible so that the focused element still makes sense?

## Composition hierarchy

For every visual beat, identify:

- **primary subject** — the UI element that carries the current idea;
- **supporting context** — nearby title, price, image, label, navigation or relationship needed to understand it;
- **expendable area** — empty or redundant space that may be cropped safely.

Crop expendable area first. Never crop supporting context before expendable area is exhausted.

## Framing rules

### 1. Establish before crop

When a new page/state appears, show the complete state first.

Typical establish duration:
- 0.8–1.5 s for a familiar/simple screen;
- up to 2.0 s only for a genuinely complex new state.

Do not begin a close framing before the viewer has spatial orientation.

### 2. Subject placement

Use compositional balance, not geometric centering.

- Place the semantic subject near a strong third/intersection when that produces a natural balance.
- Centering is allowed when the interface is itself symmetrical or the subject is a single dominant object.
- Preserve intentional negative space around the subject.
- Use UI lines, card edges, columns and alignment as leading lines that guide the eye toward the focus.

### 3. Context envelope

Every focus target gets a **context envelope** around it.

The envelope should include:
- its complete label/title;
- the full actionable control;
- the complete price/value if it is part of the decision;
- the relevant image if the image explains the item;
- enough parent-container boundary to understand grouping.

A crop is invalid if the target is visible but its meaning is no longer clear.

### 4. No destructive crop

Never cut:
- words or numbers;
- button labels;
- prices/currency;
- faces or meaningful image subjects;
- important card edges that destroy grouping;
- icons whose label/context is required;
- selected states/checkmarks;
- input value + field label relationship;
- AI question/answer bubbles being discussed.

### 5. Safe-edge rule

Keep important UI at least approximately:
- 5% of crop width from left/right edges;
- 4% of crop height from top/bottom edges.

For text blocks and buttons, prefer more room.

If the safe-edge rule cannot be satisfied at the requested zoom, reduce zoom.

### 6. Zoom limits

Default semantic push-in range:
- 1.06–1.14× for gentle attention;
- 1.14–1.24× for a clear focus beat;
- above 1.24× only for an isolated component that remains complete with its context envelope.

The strongest possible zoom is not the best crop. Use the smallest zoom that clearly changes attention.

### 7. Motion path

A push-in is a camera move, not a scale effect.

It must have:
- a motivated destination;
- stable horizon/axis;
- one smooth focal path;
- easing at the beginning and end;
- no sudden recentering;
- no oscillation between targets.

Typical push duration: 0.45–0.9 s.

### 8. Attention continuity

The end composition of one beat should prepare the beginning of the next.

Avoid:
- jumping from top-left to bottom-right with no visual bridge;
- zooming out to full view after every small action;
- repeated zoom-in/zoom-out pumping.

Prefer:
- establish → focus A → focus B → action;
- release to wider context only when the viewer needs reorientation.

### 9. Golden-ratio use

Golden-section guides may be used as a secondary composition aid, never as an automatic crop formula.

Priority order:
1. semantic completeness;
2. readability;
3. action/context relationship;
4. visual balance;
5. rule-of-thirds/golden-section refinement.

A mathematically elegant crop that removes necessary UI is wrong.

### 10. Smartphone-in-smartphone composition

The device frame is the master object in the 9:16 canvas.

- Keep the phone visually stable.
- Apply semantic crop/zoom **inside the phone screen**, not by randomly enlarging the entire device.
- Device motion is reserved for transitions or deliberate macro emphasis.
- Maintain clear separation between subtitle rail and device.
- Do not let the device bezel consume excessive usable screen area.

## Crop scoring

Before approving a crop, score 0–1:

- target completeness: 30%
- supporting-context completeness: 25%
- readability: 20%
- compositional balance: 15%
- continuity with previous/next beat: 10%

Reject below 0.85.

Any crop with incomplete required text/control is rejected regardless of score.

## QA questions

For every crop ask:

- Can I read every word needed to understand this beat?
- Do I know what this element belongs to?
- Is the target visually dominant without feeling cramped?
- Did the movement happen because attention changed?
- Would a human camera operator choose this destination?
- Does the next shot continue naturally from here?

If any answer is no, reframe.
