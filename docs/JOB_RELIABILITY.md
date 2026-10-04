# Job reliability and client progress

Demo Studio v0.13 treats every video generation as an observable, recoverable job.

## Client-visible progress

Every job exposes:

- status
- stage and human-readable stage label
- progress from 0 to 100
- current attempt and maximum attempts
- stage start time
- stage timeout
- heartbeat timestamp
- stage elapsed time
- heartbeat age
- retry reason
- recent event history
- final artifact availability

The browser progress page is:

```
/jobs/{job-id}
```

It is served by the Cloudflare Worker edge, not by the rendering container. This keeps the progress UI reachable even when the container is stalled or being restarted.

## Stages

Typical flow:

```
queued
→ preflight
→ director (when server-side directing is used)
→ capture
→ voiceover (when enabled)
→ render
→ persist
→ complete
```

Automatic recovery inserts:

```
retry_wait
```

between failed/stalled attempts.

## Heartbeat

While a job is running, the container updates its durable public snapshot and heartbeat. Public state is stored in private R2 and can be read without depending on in-memory container state.

## Recovery records

The public job snapshot never contains the source request or local paths.

A separate private recovery object contains the minimum request state needed to restart the same job. It is accessible only through the internal Durable Object token and is deleted when the job becomes terminal.

## Automatic retry

Transient exceptions retry automatically with bounded backoff under the same job ID.

Known permanent failures, such as a blocked UX/design preflight or invalid authorization/request policy, do not retry.

Default maximum attempts:

```
3
```

## Stalled-job watchdog

The Cloudflare Durable Object owns the watchdog.

Every 30 seconds it reviews active durable jobs. Each stage declares its own timeout. When a stage exceeds its timeout plus a short grace period:

1. the job moves to automatic recovery;
2. the current container is destroyed;
3. a clean container starts;
4. the private recovery record is loaded;
5. the same job ID is resumed on the next attempt.

After the maximum attempt count, the job becomes explicitly failed instead of remaining ambiguous.

## Default stage timeouts

- queue: 15 minutes
- UX/design preflight: 150 seconds
- AI Director: 180 seconds
- capture: at least 300 seconds and scaled by scenario size
- voiceover: 240 seconds
- render: 420 seconds
- durable save: 120 seconds

These values are watchdog limits, not expected durations.

## Failure semantics

A client should never have to infer whether a job is still alive.

The status page will show one of:

- active stage + percentage
- automatic retry + reason + attempt number
- completed + MP4 link
- failed + terminal error

## Production release gate

A release should verify:

- status page is reachable;
- create tool returns status_page_url;
- job status contains progress/stage/attempt/heartbeat fields;
- generation reaches completed;
- durable MP4 retrieval succeeds.
