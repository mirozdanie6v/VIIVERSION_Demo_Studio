# Demo Studio Cloudflare container cost control (2026-10-15)

## Scope

- Keep the account's Workers Paid plan ($5/month).
- Keep the R2 video artifacts, checkpoints and Durable Object state.
- Preserve the existing `standard-1` container size (4 GiB RAM / 8 GB disk) pending actual performance benchmarks.
- Change **only Demo Studio** lifecycle behaviour; no other VIIVERSION application or Cloudflare account-wide setting is changed.

## Behaviour

- `GET /health` and `HEAD /health`: edge-only response. This endpoint does **not** start a video container. The JSON explicitly states `healthScope=edge`, `containerChecked=false`.
- `GET /health/runtime`: expensive deep probe; starts the container and verifies the internal HTTP server. Only use for deployment validation, not scheduled monitoring.
- Any other real generation/MCP request: container starts on demand as before.
- No active job marker: 10-minute inactivity timeout.
- One or more active job markers in Durable Object storage: retain the original 60-minute safety timeout. Job progress/recovery writes update this choice; watchdog alarms also refresh it. Normal shutdown still belongs to Cloudflare inactivity expiry, not a forced kill.
- `GET /__admin/active-jobs`: read-only, authenticated snapshot of the Durable Object's tracked jobs and whether the container is running. Returns HTTP 403 if `DEMO_STUDIO_API_KEY` is unset or not supplied. It does not start the container.

## Deployment release gate (must complete before production)

The production GitHub Actions workflow **deploys the release pinned in** `mirozdanie6v/rusinfocenter/.deploy-demo-studio`; merging this patch into Demo Studio does not by itself publish the changed Worker source. Editing `.github/workflows/deploy-production.yml` on `main` can invoke the pinned deployment. Treat merge / pin update / deploy as production operations that require the following checks.

1. Inspect the live Demo Studio queue and R2 recovery records with production credentials (do **not** disclose the key in a chat or commit).
2. Verify there are no `queued`, `capturing`, `rendering`, `retrying` or unknown jobs. Inspect `recovery/*` records as well as Durable Object `active-job:*` markers. Missing snapshots count as unresolved and block deploy.
3. Confirm there is no rendering currently executing inside the live container, especially during the short gap between POST acceptance and recovery-marker creation.
4. Recheck immediately before promotion to production. If any pending job exists, postpone deployment until it finishes or is recovered by the existing watchdog. **Never destroy an active container solely for cost savings.**
5. After the checked cutover, deploy the pinned revision and run the existing smoke checks. Production deployment verification now uses `/health/runtime` to check the actual container, rather than mistaking edge-only `/health` for runtime readiness.
6. After deployment with `DEMO_STUDIO_API_KEY` configured, the read-only status route can help audits:

   ```bash
   curl -fsS \
     -H "Authorization: Bearer ${DEMO_STUDIO_API_KEY}" \
     https://demostudio.viiversion.com/__admin/active-jobs
   ```

   If the service intentionally operates without `DEMO_STUDIO_API_KEY`, the admin route remains disabled; inspect the production Durable Object storage and R2 recovery state through authorized infrastructure tooling instead.
7. Verify root and privacy pages, authenticated MCP, one test video, completed artifact retrieval and continued cold-start behaviour after >10 minutes idle. Ensure no active job is interrupted. Observe runtime error rate and Cloudflare container memory/disk billable usage.

## Rollback

Re-pin the last known-good revision only when no pending job is active; deploy through the controlled production workflow. Do not delete R2 objects, Durable Object state or account-wide billing subscriptions to perform rollback.

## Cost measurement

Cloudflare's invoice from 2026-10-14 was $13.58: Workers Paid $5, container provisioned memory $8.16, container disk $0.42. The effective next bill cannot be measured from the code change alone. Compare container GiB-seconds, GB-seconds, startup count and video-job throughput for equivalent usage before and after rollout. Free monthly allowances are shared at account level. Other workloads could also contribute.
