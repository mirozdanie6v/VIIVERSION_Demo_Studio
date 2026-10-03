# Demo Studio development process

Demo Studio has three independent delivery lanes. A green state in one lane does not imply that the other two are complete.

## 1. Core development lane

Purpose: change the Demo Studio engine safely.

Automatic gates:

- Pull request CI
  - TypeScript typecheck
  - Cloudflare Worker syntax check
  - unit tests
- Main branch CI
- Recording Smoke Test when core-affecting files change
  - Chromium capture
  - FFmpeg render
  - Editor Brain artifacts
  - Editor Critic pass
  - Music Brain artifact
  - Caption Brain artifact
  - final MP4

Definition of done for a core change:

1. PR CI passes.
2. Change is merged to `main`.
3. Main CI passes.
4. If the change affects capture/render/editorial code, Recording Smoke passes.

A green core lane means the repository implementation is healthy. It does not mean MAX TOUR client videos have been regenerated and it does not mean production has been deployed.

## 2. Client render regression lane

Purpose: generate and visually review specific client/demo presentations.

Current workflows:

- MAX TOUR Client Video
- MAX TOUR English 2-Minute Presentation
- MAX TOUR Russian Premium Presentation

These workflows are expensive because they install Chromium, FFmpeg and sometimes TTS/audio tooling.

Automatic triggers are limited to that presentation's own scenario/spec/workflow changes.

After a core renderer or Editor Brain change, run the relevant client workflow explicitly with `workflow_dispatch` only when a client regression render is needed.

Definition of done for a client video:

1. Scenario capture succeeds.
2. Editorial/render checks succeed.
3. Final artifact is uploaded.
4. Visual/audio QA is completed for the actual client output.

Client render failure does not make unrelated core development "stuck"; it is a separate integration/regression problem.

## 3. Production release lane

Purpose: deploy a selected Demo Studio commit to `demostudio.viiversion.com`.

Production is deployed through the RIC repository.

Every release must record:

- Demo Studio semantic version from `package.json`
- exact Demo Studio source commit SHA
- target domain
- RIC deploy commit/run

Release gate:

1. Core target commit is green.
2. RIC release marker is updated to the intended version and exact source SHA.
3. Cloudflare deploy succeeds.
4. Production `/health` reports the same semantic version.
5. MCP initialize succeeds.
6. MCP tool list succeeds.
7. Plugin-native production generation produces a real MP4.
8. Artifact retrieval succeeds.

A green `main` is not a production release.

## Linear state rules

- Parent milestone can be Done only when its stated milestone is complete.
- Remaining hardening/features stay as separate In Progress/Todo issues.
- Implementation present in code moves a child issue from Todo to In Progress.
- Issue moves to Done only after its acceptance criteria are verified by tests or a release gate.

## Current release drift

At the time this document was introduced:

- Demo Studio main/package: `0.11.0`
- RIC release marker: `0.10.1`

Tracked by Linear issue `VII-67`.

## Recommended sequence

For ordinary engine work:

```
feature branch
→ PR CI
→ merge main
→ core smoke
→ optional explicit client regression render
→ release only when selected
```

For a client-only presentation edit:

```
client scenario/spec branch
→ PR CI
→ merge
→ that client render workflow
→ visual/audio QA
```

For release:

```
choose green main SHA
→ update RIC release marker with version + SHA
→ deploy
→ production health/MCP/render checks
→ mark release issue Done
```
