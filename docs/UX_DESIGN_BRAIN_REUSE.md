# UX / Design Brain reuse map

Demo Studio v0.12 reuses verified VIIVERSION UX/UI entities rather than introducing a third independent design system.

## Verified reuse sources

### Mini App Factory

Repository: `mirozdanie6v/mini-app-factory`

Reused concepts and implementation patterns:

- `apps/orchestrator/src/preview-qa.mjs`
  - real browser QA against desktop and mobile viewports
  - horizontal overflow detection
  - visible main-content checks
  - accessible-name checks for controls
  - browser console error capture
  - failed request capture
  - external-origin observation
  - screenshot evidence
- `docs/QUALITY_RUBRIC_V1.md`
  - UX/UI/accessibility is an independent required quality dimension
  - aggregate quality cannot hide a failed UX/UI dimension
- immutable preview/evidence model
  - QA artifacts are bound to a concrete run instead of being inferred from a successful build

### KP Universal Proposal Orchestrator

Repository: `mirozdanie6v/KP-universal-proposal-orchestrator`

Reused concepts:

- `ui-ux-audit-fix`
  - separate visual, interaction, implementation and requirement-mismatch findings
  - inspect the existing product before redesigning
  - smallest coherent change
  - verification must check user-visible behavior
- `visual-system.md`
  - infer typography, color, geometry and interaction patterns from the current interface
  - prefer local consistency over inventing a new style
- `mobile-ios.md`
  - mobile viewport and touch-target rules
  - safe-area / fixed / sticky / overflow awareness
- Proposal Review Board
  - independent reviewer does not directly edit the artifact
  - PASS / REVISE / BLOCKED contract
  - finding → owner stage → required action
- bounded revision loops
  - automatic revisions are limited
  - repeated failure stops as BLOCKED rather than looping forever

## v0.12 pipeline

```
URL
  ↓
UX Design Brain preflight
  ├─ desktop browser QA
  ├─ mobile browser QA
  ├─ design profile
  └─ design contract
  ↓
Director / Capture
  ↓
Editor Brain
  ↓
Presentation Design Brain
  ├─ active UI camera geometry
  ├─ caption safe region
  └─ brand safe corner
  ↓
Visual Critic
  ├─ PASS
  ├─ REVISE (bounded)
  └─ BLOCKED
  ↓
FFmpeg Render
```

## Evidence artifacts

Preflight:

- `ux_preflight.json`
- `design_profile.json`
- `design_contract.json`
- `ux_desktop.png`
- `ux_mobile.png`

Render:

- `overlay_plan.json`
- `visual_critic.json`

Existing editorial artifacts remain:

- `editor_brain.json`
- `editor_critic.json`
- `music_brain.json`
- `captions.json`
- `scenes.json`

## Design contract

The Design Profiler extracts:

- body and heading typography
- background/surface/text/action/border colors
- common card radius and spacing
- content width
- button and input geometry
- fixed/sticky and focusable-control counts

The contract then decides preferred caption region and branding corner separately for desktop and mobile.

The Presentation Design Brain may revise that preference using actual recorded active-element camera geometry.

## Independence

UX/Design Preflight evaluates the target application.

Presentation Design Brain decides overlay composition.

Visual Critic evaluates the planned composition and never directly edits it.

If the critic returns REVISE, only the presentation-design stage is recalculated. Automatic revision is bounded. BLOCKED requires an explicit product/design decision.
