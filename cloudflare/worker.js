import { DurableObject } from "cloudflare:workers";
import { evaluateJobWatchdog } from "./watchdog-policy.js";

const PUBLIC_HOST = "demostudio.viiversion.com";
const CONTAINER_PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;
const ACTIVE_IMAGE_KEY = "active-container-image";
const ACTIVE_HYBRID_KEY = "active-production-hybrid";
const INTERNAL_TOKEN_KEY = "internal-storage-token";
const GENERATION_DAILY_LIMIT = 10;
const INSPECTION_DAILY_LIMIT = 30;
const ACTIVE_JOB_PREFIX = "active-job:";
const JOB_WATCHDOG_INTERVAL_MS = 30 * 1000;
const JOB_WATCHDOG_GRACE_MS = 15 * 1000;
const CHECKPOINT_FILE_NAMES = new Set([
  "scenario.json",
  "storyboard.md",
  "design_contract.json",
  "ux_preflight.json",
  "run.json",
  "capture.webm",
  "hybrid-capture.bundle.json",
  "voiceover.mp3",
]);

function staticPage(title, body) {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · VIIVERSION Demo Studio</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #090b10; color: #f5f7fb; }
    main { max-width: 820px; margin: 0 auto; padding: 72px 28px 96px; }
    a { color: #b7c9ff; }
    h1 { font-size: clamp(38px, 7vw, 72px); line-height: .98; margin: 18px 0 28px; }
    h2 { margin-top: 38px; }
    p, li { color: #c9ced8; line-height: 1.65; }
    .eyebrow { letter-spacing: .16em; text-transform: uppercase; color: #8f98aa; font-size: 12px; }
    .card { margin-top: 34px; padding: 22px 24px; border: 1px solid #282d38; border-radius: 18px; background: #11151d; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">VIIVERSION · Demo Studio</div>
    ${body}
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function jobStatusPage(jobId) {
  const safeId = String(jobId).replace(/[^0-9a-f-]/gi, "");
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Generation progress · VIIVERSION Demo Studio</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
body{margin:0;background:#090b10;color:#f5f7fb}
main{max-width:760px;margin:0 auto;padding:56px 24px 88px}
.muted{color:#9ea6b8}.card{background:#11151d;border:1px solid #282d38;border-radius:18px;padding:22px;margin-top:20px}
.bar{height:14px;border-radius:999px;background:#222733;overflow:hidden;margin:18px 0 10px}
.fill{height:100%;width:0;background:linear-gradient(90deg,#9a7cff,#54d5ff);transition:width .35s ease}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}.pill{border:1px solid #343a48;border-radius:999px;padding:7px 11px;font-size:13px}
.history{margin:0;padding:0;list-style:none}.history li{padding:10px 0;border-top:1px solid #242a34;color:#c9ced8}
.error{color:#ffb0b0;white-space:pre-wrap}a{color:#b7c9ff}code{word-break:break-all}
</style>
</head>
<body><main>
<div class="muted">VIIVERSION · Demo Studio</div>
<h1>Generation progress</h1>
<div class="card">
<div id="stage">Loading…</div>
<div class="bar"><div class="fill" id="fill"></div></div>
<div id="percent">0%</div>
<p id="message" class="muted">Connecting to durable job state…</p>
<div class="row"><span class="pill" id="attempt">Attempt —</span><span class="pill" id="elapsed">Stage —</span><span class="pill" id="heartbeat">Heartbeat —</span></div>
<p id="retry" class="muted"></p><p id="error" class="error"></p><p id="artifact"></p>
</div>
<div class="card"><strong>Recent activity</strong><ul id="history" class="history"></ul></div>
<p class="muted">Job ID: <code>${safeId}</code></p>
</main>
<script>
const jobId=${JSON.stringify(safeId)};
const endpoint="/v1/jobs/"+encodeURIComponent(jobId);
const $=(id)=>document.getElementById(id);
const age=(iso)=>iso?Math.max(0,Math.floor((Date.now()-Date.parse(iso))/1000)):0;
function render(job){
 $("stage").textContent=job.stageLabel||job.stage||job.status;
 $("fill").style.width=Math.max(0,Math.min(100,job.progress||0))+"%";
 $("percent").textContent=(job.progress||0)+"%";
 $("message").textContent=job.message||"";
 $("attempt").textContent="Attempt "+(job.attempt||1)+"/"+(job.maxAttempts||1);
 $("elapsed").textContent="Stage "+age(job.stageStartedAt)+"s";
 $("heartbeat").textContent="Heartbeat "+age(job.heartbeatAt)+"s ago";
 $("retry").textContent=job.retryReason?"Automatic recovery: "+job.retryReason:"";
 $("error").textContent=job.error||"";
 $("artifact").innerHTML=job.artifactReady?'<a href="'+endpoint+'/artifact">Open final MP4</a>':"";
 const history=$("history");history.innerHTML="";
 for(const item of (job.history||[]).slice().reverse()){
  const li=document.createElement("li");
  li.textContent=new Date(item.at).toLocaleTimeString()+" · "+(item.stage||item.status)+" · "+item.progress+"% · "+item.message;
  history.appendChild(li);
 }
 return job.status!=="completed"&&job.status!=="failed";
}
async function poll(){
 try{
  const r=await fetch(endpoint,{cache:"no-store"});
  if(!r.ok)throw new Error("Status request returned HTTP "+r.status);
  const keep=render(await r.json());
  if(keep)setTimeout(poll,2000);
 }catch(error){
  $("message").textContent="Connection problem. Retrying automatically…";
  $("error").textContent=String(error&&error.message?error.message:error);
  setTimeout(poll,3000);
 }
}
poll();
</script></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function publicStaticResponse(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return undefined;
  const url = new URL(request.url);

  const jobStatusMatch = url.pathname.match(
    /^\/jobs\/([0-9a-f-]{36})$/i,
  );
  if (jobStatusMatch) {
    return jobStatusPage(jobStatusMatch[1]);
  }

  if (url.pathname === "/") {
    return staticPage(
      "Web app presentation videos",
      `<h1>Turn web apps into polished demo videos.</h1>
<p>VIIVERSION Demo Studio inspects a web interface, records an authorized walkthrough, and renders a presentation-ready MP4 with motion, captions, branding, and multiple aspect ratios.</p>
<div class="card"><strong>MCP endpoint</strong><p><code>https://demostudio.viiversion.com/mcp</code></p></div>
<p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>`,
    );
  }

  if (url.pathname === "/privacy") {
    return staticPage(
      "Privacy Policy",
      `<h1>Privacy Policy</h1>
<p>Effective October 3, 2026.</p>
<h2>What Demo Studio processes</h2>
<p>When you create a demonstration, the service processes the target URL, the demo scenario or goal, relevant interface information collected from the target application, and the browser recording needed to render the requested video.</p>
<h2>Storage and retention</h2>
<p>Working files are created inside the rendering environment while a job runs. Completed job metadata and the final MP4 may be stored in private Cloudflare R2 storage for up to 7 days so the result can be retrieved. The service automatically expires these stored artifacts after the retention period.</p>
<h2>Credentials and sensitive data</h2>
<p>Externally generated scenarios are blocked from referencing server environment variables. Users should avoid placing passwords, private keys, access tokens, payment data, or other sensitive information in demo scenarios. Only applications the user is authorized to access should be inspected or recorded.</p>
<h2>Service providers</h2>
<p>Cloudflare infrastructure is used to run the service and store temporary result artifacts. Optional server-generated AI narration or server-side AI planning may use configured AI providers when those features are enabled.</p>
<h2>Use of data</h2>
<p>VIIVERSION does not sell Demo Studio user data or use submitted demo content for advertising targeting.</p>
<h2>Operational information</h2>
<p>Operational logs may contain request metadata, status codes, performance information, and error messages needed to operate and secure the service.</p>
<h2>Contact</h2>
<p>Questions about this policy can be directed to VIIVERSION through <a href="https://viiversion.com">viiversion.com</a>.</p>`,
    );
  }

  if (url.pathname === "/support") {
    return staticPage(
      "Support",
      `<h1>Support</h1>
<p>VIIVERSION Demo Studio creates presentation videos from authorized web applications.</p>
<h2>Before reporting a problem</h2>
<ul>
  <li>Confirm the target URL is publicly reachable over HTTPS.</li>
  <li>Use a non-destructive test flow.</li>
  <li>Keep the job ID if a generation fails or remains incomplete.</li>
</ul>
<h2>Support</h2>
<p>For product and review support, contact VIIVERSION through <a href="https://viiversion.com">viiversion.com</a> and include “Demo Studio” plus the relevant job ID when available.</p>
<h2>Service status</h2>
<p>The production health endpoint is <a href="/health">/health</a>.</p>`,
    );
  }

  if (url.pathname === "/terms") {
    return staticPage(
      "Terms of Service",
      `<h1>Terms of Service</h1>
<p>Effective October 3, 2026.</p>
<h2>Authorized use</h2>
<p>You may use Demo Studio only with websites and applications you are authorized to inspect, access, and record. You are responsible for the actions included in a demo scenario and for complying with applicable law and third-party terms.</p>
<h2>Consequential actions</h2>
<p>Demo Studio is designed primarily for presentation and test workflows. Avoid real purchases, payments, bookings, destructive changes, account deletion, irreversible submissions, or other consequential actions unless you intentionally configured an authorized test environment for that purpose.</p>
<h2>Service limits</h2>
<p>The service may apply rate limits, daily generation limits, inspection limits, file-retention limits, and other safeguards to protect availability and control abusive or excessive use.</p>
<h2>Generated outputs</h2>
<p>Generated videos are provided as-is. You are responsible for reviewing the output before publishing or distributing it and for ensuring you have rights to the recorded interface, trademarks, images, text, and other material appearing in the video.</p>
<h2>Retention</h2>
<p>Generated artifacts are temporary and may be automatically deleted after 7 days. Keep your own copy of any output you need to retain.</p>
<h2>Changes and availability</h2>
<p>VIIVERSION may update the service, these terms, usage limits, or supported features as the product evolves.</p>
<h2>Contact</h2>
<p>Questions about these terms can be directed to VIIVERSION through <a href="https://viiversion.com">viiversion.com</a>.</p>`,
    );
  }

  return undefined;
}

function bearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}


async function quotaIdentity(request) {
  const token = bearerToken(request);
  if (!token) return "anonymous-global";

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );

  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class DemoStudioContainer extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.starting = undefined;

    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        ctx.container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  async consumeDailyQuota(request, kind, limit) {
    const identity = await quotaIdentity(request);
    const day = new Date().toISOString().slice(0, 10);
    const key = "quota:" + day + ":" + kind + ":" + identity;

    return this.ctx.storage.transaction(async (txn) => {
      const used = Number((await txn.get(key)) ?? 0);

      if (used >= limit) {
        return { allowed: false, used, limit, remaining: 0 };
      }

      const next = used + 1;
      await txn.put(key, next);

      return {
        allowed: true,
        used: next,
        limit,
        remaining: Math.max(0, limit - next),
      };
    });
  }

  quotaErrorResponse(payload, kind, quota) {
    const message =
      "Daily " + kind + " quota exceeded. Try again after 00:00 UTC.";

    if (payload?.jsonrpc === "2.0") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32029,
            message,
            data: quota,
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ error: message, quota }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  async enforceEdgeQuota(request, url) {
    if (request.method !== "POST") return undefined;

    if (url.pathname === "/v1/jobs") {
      const quota = await this.consumeDailyQuota(
        request,
        "generation",
        GENERATION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(undefined, "generation", quota);
    }

    if (url.pathname !== "/mcp") return undefined;

    let payload;
    try {
      payload = await request.clone().json();
    } catch {
      return undefined;
    }

    if (
      payload?.method !== "tools/call" ||
      typeof payload?.params?.name !== "string"
    ) {
      return undefined;
    }

    const tool = payload.params.name;
    if (
      tool === "create_demo_video" ||
      tool === "create_demo_video_from_scenario"
    ) {
      const quota = await this.consumeDailyQuota(
        request,
        "generation",
        GENERATION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(payload, "generation", quota);
    }

    if (
      tool === "inspect_web_app" ||
      tool === "audit_web_app_design"
    ) {
      const quota = await this.consumeDailyQuota(
        request,
        "inspection",
        INSPECTION_DAILY_LIMIT,
      );
      return quota.allowed
        ? undefined
        : this.quotaErrorResponse(payload, "inspection", quota);
    }

    return undefined;
  }

  async getInternalToken() {
    let token = await this.ctx.storage.get(INTERNAL_TOKEN_KEY);

    if (!token) {
      token = crypto.randomUUID() + "-" + crypto.randomUUID();
      await this.ctx.storage.put(INTERNAL_TOKEN_KEY, token);
    }

    return token;
  }

  isPublicAuthorized(request) {
    const configured = this.env.DEMO_STUDIO_API_KEY;
    if (!configured) return true;
    return bearerToken(request) === configured;
  }

  async scheduleWatchdog() {
    const existing = await this.ctx.storage.getAlarm();
    const target = Date.now() + JOB_WATCHDOG_INTERVAL_MS;
    if (!existing || existing > target) {
      await this.ctx.storage.setAlarm(target);
    }
  }

  async clearActiveJob(id) {
    await Promise.all([
      this.ctx.storage.delete(ACTIVE_JOB_PREFIX + id),
      this.env.DEMO_STUDIO_ARTIFACTS.delete([
        "recovery/" + id + ".json",
        ...Array.from(CHECKPOINT_FILE_NAMES, (name) =>
          "checkpoints/" + id + "/" + name
        ),
      ]),
    ]);
  }

  async handleInternalRequest(request, url) {
    const artifactMatch = url.pathname.match(
      /^\/__internal\/artifacts\/([0-9a-f-]{36})$/i,
    );
    const jobMatch = url.pathname.match(
      /^\/__internal\/jobs\/([0-9a-f-]{36})$/i,
    );
    const recoveryMatch = url.pathname.match(
      /^\/__internal\/recovery\/([0-9a-f-]{36})$/i,
    );
    const checkpointMatch = url.pathname.match(
      /^\/__internal\/checkpoints\/([0-9a-f-]{36})\/([a-z0-9._-]+)$/i,
    );

    if (
      !artifactMatch &&
      !jobMatch &&
      !recoveryMatch &&
      !checkpointMatch
    ) {
      return undefined;
    }

    const expected = await this.getInternalToken();
    if (bearerToken(request) !== expected) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (checkpointMatch && request.method === "GET") {
      const id = checkpointMatch[1];
      const name = checkpointMatch[2];
      if (!CHECKPOINT_FILE_NAMES.has(name)) {
        return new Response("Checkpoint file is not allowed", { status: 400 });
      }

      const object = await this.env.DEMO_STUDIO_ARTIFACTS.get(
        "checkpoints/" + id + "/" + name,
      );
      if (!object) return new Response("Not found", { status: 404 });

      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type":
            object.httpMetadata?.contentType ?? "application/octet-stream",
          "Content-Length": String(object.size),
          "Cache-Control": "no-store",
          ETag: object.httpEtag,
        },
      });
    }

    if (request.method !== "PUT") {
      return new Response("Method not allowed", { status: 405 });
    }

    if (checkpointMatch) {
      const id = checkpointMatch[1];
      const name = checkpointMatch[2];
      if (!CHECKPOINT_FILE_NAMES.has(name)) {
        return new Response("Checkpoint file is not allowed", { status: 400 });
      }

      await this.env.DEMO_STUDIO_ARTIFACTS.put(
        "checkpoints/" + id + "/" + name,
        request.body,
        {
          httpMetadata: {
            contentType:
              request.headers.get("content-type") ??
              "application/octet-stream",
            cacheControl: "no-store",
          },
        },
      );
      return new Response(null, { status: 204 });
    }

    if (artifactMatch) {
      await this.env.DEMO_STUDIO_ARTIFACTS.put(
        "artifacts/" + artifactMatch[1] + ".mp4",
        request.body,
        {
          httpMetadata: {
            contentType: "video/mp4",
            cacheControl: "private, max-age=3600",
          },
        },
      );
      return new Response(null, { status: 204 });
    }

    if (recoveryMatch) {
      const id = recoveryMatch[1];
      const source = await request.text();
      JSON.parse(source);
      await this.env.DEMO_STUDIO_ARTIFACTS.put(
        "recovery/" + id + ".json",
        source,
        {
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "no-store",
          },
        },
      );
      await this.ctx.storage.put(ACTIVE_JOB_PREFIX + id, { id });
      await this.scheduleWatchdog();
      return new Response(null, { status: 204 });
    }

    const id = jobMatch[1];
    const source = await request.text();
    const snapshot = JSON.parse(source);

    await this.env.DEMO_STUDIO_ARTIFACTS.put(
      "jobs/" + id + ".json",
      source,
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "no-store",
        },
      },
    );

    if (snapshot.status === "completed" || snapshot.status === "failed") {
      await this.clearActiveJob(id);
    } else {
      await this.ctx.storage.put(ACTIVE_JOB_PREFIX + id, { id });
      await this.scheduleWatchdog();
    }

    return new Response(null, { status: 204 });
  }

  async handlePersistedRead(request, url) {
    if (request.method !== "GET") return undefined;

    const artifactMatch = url.pathname.match(
      /^\/v1\/jobs\/([0-9a-f-]{36})\/artifact$/i,
    );
    const jobMatch = url.pathname.match(
      /^\/v1\/jobs\/([0-9a-f-]{36})$/i,
    );

    if (!artifactMatch && !jobMatch) return undefined;

    if (!this.isPublicAuthorized(request)) {
      return new Response(
        JSON.stringify({ error: "Invalid or missing bearer token." }),
        {
          status: 401,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    if (artifactMatch) {
      const object = await this.env.DEMO_STUDIO_ARTIFACTS.get(
        "artifacts/" + artifactMatch[1] + ".mp4",
      );

      if (!object) return undefined;

      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(object.size),
          "Content-Disposition":
            'attachment; filename="viiversion-demo-' +
            artifactMatch[1] +
            '.mp4"',
          "Cache-Control": "private, max-age=3600",
          ETag: object.httpEtag,
        },
      });
    }

    const object = await this.env.DEMO_STUDIO_ARTIFACTS.get(
      "jobs/" + jobMatch[1] + ".json",
    );

    if (!object) return undefined;

    const snapshot = JSON.parse(await object.text());
    const now = Date.now();
    const stageStarted = Date.parse(
      snapshot.stageStartedAt ?? snapshot.updatedAt ?? snapshot.createdAt,
    );
    const heartbeatAt = Date.parse(
      snapshot.heartbeatAt ?? snapshot.updatedAt ?? snapshot.createdAt,
    );
    const stageElapsedSeconds = Number.isFinite(stageStarted)
      ? Math.max(0, Math.floor((now - stageStarted) / 1000))
      : 0;
    const heartbeatAgeSeconds = Number.isFinite(heartbeatAt)
      ? Math.max(0, Math.floor((now - heartbeatAt) / 1000))
      : 0;
    const timeout = Math.max(
      30,
      Number(snapshot.stageTimeoutSeconds ?? 300),
    );
    const terminal =
      snapshot.status === "completed" || snapshot.status === "failed";

    snapshot.stageElapsedSeconds = stageElapsedSeconds;
    snapshot.heartbeatAgeSeconds = heartbeatAgeSeconds;
    snapshot.stalled = !terminal && stageElapsedSeconds > timeout;

    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ETag: object.httpEtag,
      },
    });
  }

  async failStalledJob(id, snapshot, reason) {
    const now = new Date().toISOString();
    const history = Array.isArray(snapshot.history)
      ? snapshot.history.slice(-19)
      : [];
    history.push({
      at: now,
      status: "failed",
      stage: "failed",
      progress: 100,
      message: reason,
      attempt: Number(snapshot.attempt ?? 1),
    });

    const failed = {
      ...snapshot,
      status: "failed",
      stage: "failed",
      stageLabel: "Failed",
      progress: 100,
      message: reason,
      error: reason,
      updatedAt: now,
      heartbeatAt: now,
      stageStartedAt: now,
      stageTimeoutSeconds: 86400,
      completedAt: now,
      stalled: false,
      history,
    };

    await this.env.DEMO_STUDIO_ARTIFACTS.put(
      "jobs/" + id + ".json",
      JSON.stringify(failed),
      {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "no-store",
        },
      },
    );
    await this.clearActiveJob(id);
  }

  async restartStalledJob(id, snapshot, recovery) {
    const currentAttempt = Number(snapshot.attempt ?? recovery.attempt ?? 1);
    const maxAttempts = Number(snapshot.maxAttempts ?? recovery.maxAttempts ?? 3);

    if (currentAttempt >= maxAttempts) {
      await this.failStalledJob(
        id,
        snapshot,
        "The job stopped making progress and reached the automatic recovery limit.",
      );
      return;
    }

    const nextAttempt = currentAttempt + 1;
    const now = new Date().toISOString();
    const reason =
      "Watchdog detected that stage " +
      String(snapshot.stage ?? snapshot.status ?? "unknown") +
      " exceeded its timeout.";

    const history = Array.isArray(snapshot.history)
      ? snapshot.history.slice(-19)
      : [];
    history.push({
      at: now,
      status: "retrying",
      stage: "retry_wait",
      progress: Math.min(Number(snapshot.progress ?? 0), 95),
      message:
        "Automatic watchdog recovery is restarting the job (attempt " +
        nextAttempt +
        "/" +
        maxAttempts +
        ").",
      attempt: nextAttempt,
    });

    const retrySnapshot = {
      ...snapshot,
      status: "retrying",
      stage: "retry_wait",
      stageLabel: "Automatic recovery",
      progress: Math.min(Number(snapshot.progress ?? 0), 95),
      message:
        "The current stage stopped progressing. Demo Studio is restarting it automatically.",
      updatedAt: now,
      heartbeatAt: now,
      stageStartedAt: now,
      stageTimeoutSeconds: 90,
      attempt: nextAttempt,
      maxAttempts,
      retryReason: reason,
      stalled: false,
      history,
      error: undefined,
      completedAt: undefined,
    };

    const nextRecovery = {
      ...recovery,
      attempt: nextAttempt,
      maxAttempts,
      history,
    };

    await Promise.all([
      this.env.DEMO_STUDIO_ARTIFACTS.put(
        "jobs/" + id + ".json",
        JSON.stringify(retrySnapshot),
        {
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "no-store",
          },
        },
      ),
      this.env.DEMO_STUDIO_ARTIFACTS.put(
        "recovery/" + id + ".json",
        JSON.stringify(nextRecovery),
        {
          httpMetadata: {
            contentType: "application/json; charset=utf-8",
            cacheControl: "no-store",
          },
        },
      ),
    ]);

    const container = this.ctx.container;
    if (container?.running) {
      await container.destroy(
        "Restarting stalled Demo Studio generation job " + id,
      );
    }

    this.starting = undefined;
    await this.startAndWaitForPort();

    const token = await this.getInternalToken();
    const response = await this.ctx.container
      .getTcpPort(CONTAINER_PORT)
      .fetch("http://container/__internal/retry/" + id, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "x-forwarded-host": PUBLIC_HOST,
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({
          recovery: nextRecovery,
          reason,
        }),
        signal: AbortSignal.timeout(30_000),
      });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        "Container recovery returned HTTP " +
          response.status +
          ": " +
          detail,
      );
    }
    await response.body?.cancel();
  }

  async alarm() {
    try {
      const active = await this.ctx.storage.list({
        prefix: ACTIVE_JOB_PREFIX,
      });

      for (const key of active.keys()) {
        const id = key.slice(ACTIVE_JOB_PREFIX.length);
        const jobObject = await this.env.DEMO_STUDIO_ARTIFACTS.get(
          "jobs/" + id + ".json",
        );

        if (!jobObject) continue;

        const snapshot = JSON.parse(await jobObject.text());
        if (snapshot.status === "completed" || snapshot.status === "failed") {
          await this.clearActiveJob(id);
          continue;
        }

        const decision = evaluateJobWatchdog(
          snapshot,
          Date.now(),
          JOB_WATCHDOG_GRACE_MS,
        );

        if (decision.action === "ignore") {
          await this.clearActiveJob(id);
          continue;
        }
        if (decision.action === "wait") continue;
        if (decision.action === "fail") {
          await this.failStalledJob(
            id,
            snapshot,
            "The job stopped making progress and reached the automatic recovery limit.",
          );
          continue;
        }

        const recoveryObject =
          await this.env.DEMO_STUDIO_ARTIFACTS.get(
            "recovery/" + id + ".json",
          );
        if (!recoveryObject) {
          await this.failStalledJob(
            id,
            snapshot,
            "The job stalled and no private recovery record was available.",
          );
          continue;
        }

        const recovery = JSON.parse(await recoveryObject.text());
        await this.restartStalledJob(id, snapshot, recovery);
      }
    } catch (error) {
      console.error("[watchdog]", error);
    } finally {
      const remaining = await this.ctx.storage.list({
        prefix: ACTIVE_JOB_PREFIX,
      });
      if (remaining.size > 0) {
        await this.ctx.storage.setAlarm(
          Date.now() + JOB_WATCHDOG_INTERVAL_MS,
        );
      }
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    const internal = await this.handleInternalRequest(request, url);
    if (internal) return internal;

    const persisted = await this.handlePersistedRead(request, url);
    if (persisted) return persisted;

    const quotaResponse = await this.enforceEdgeQuota(request, url);
    if (quotaResponse) return quotaResponse;

    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    url.protocol = "http:";
    url.host = "container";

    const forwarded = new Request(url.toString(), request);
    forwarded.headers.set("x-forwarded-host", PUBLIC_HOST);
    forwarded.headers.set("x-forwarded-proto", "https");

    return this.ctx.container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  async ensureCurrentRuntime(container) {
    const desiredImage = container.images.app;
    const desiredHybrid =
      String(this.env.DEMO_STUDIO_PRODUCTION_HYBRID ?? "true")
        .trim()
        .toLowerCase() === "false"
        ? "false"
        : "true";
    const [activeImage, activeHybrid] = await Promise.all([
      this.ctx.storage.get(ACTIVE_IMAGE_KEY),
      this.ctx.storage.get(ACTIVE_HYBRID_KEY),
    ]);

    if (
      container.running &&
      (activeImage !== desiredImage || activeHybrid !== desiredHybrid)
    ) {
      await container.destroy(
        "Replacing stale Demo Studio container runtime",
      );
      await Promise.all([
        this.ctx.storage.delete(ACTIVE_IMAGE_KEY),
        this.ctx.storage.delete(ACTIVE_HYBRID_KEY),
      ]);
    }

    return { desiredImage, desiredHybrid };
  }

  async startAndWaitForPort() {
    const container = this.ctx.container;
    if (!container) {
      throw new Error("Cloudflare Container binding is unavailable.");
    }

    const { desiredImage, desiredHybrid } = await this.ensureCurrentRuntime(container);

    if (!container.running) {
      const internalToken = await this.getInternalToken();
      const env = {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: String(CONTAINER_PORT),
        PUBLIC_BASE_URL: "https://" + PUBLIC_HOST,
        OPENAI_DIRECTOR_MODEL: "gpt-5.6-luna",
        OPENAI_TTS_MODEL: "gpt-4o-mini-tts",
        OPENAI_TTS_VOICE: "marin",
        DEMO_STUDIO_ALLOWED_API_HOSTS:
          PUBLIC_HOST + ",container,localhost,127.0.0.1",
        DEMO_STUDIO_ALLOWED_ORIGINS: "https://" + PUBLIC_HOST,
        DEMO_STUDIO_REUSE_BROWSER: "true",
        DEMO_STUDIO_FFMPEG_PRESET:
          this.env.DEMO_STUDIO_FFMPEG_PRESET ?? "veryfast",
        DEMO_STUDIO_PRODUCTION_HYBRID: desiredHybrid,
        DEMO_STUDIO_MAX_CONCURRENT_JOBS: "1",
        DEMO_STUDIO_DAILY_JOB_LIMIT: "10",
        DEMO_STUDIO_MAX_JOB_ATTEMPTS: "3",
        DEMO_STUDIO_HEARTBEAT_MS: "10000",
        DEMO_STUDIO_STORAGE_ROOT: "/data/jobs",
        DEMO_STUDIO_INTERNAL_TOKEN: internalToken,
        ALLOW_PRIVATE_TARGETS: "false",
        DEMO_STUDIO_ALLOW_UNAUTHENTICATED: this.env.DEMO_STUDIO_API_KEY
          ? "false"
          : "true",
      };

      if (this.env.OPENAI_API_KEY) {
        env.OPENAI_API_KEY = this.env.OPENAI_API_KEY;
      }

      if (this.env.DEMO_STUDIO_API_KEY) {
        env.DEMO_STUDIO_API_KEY = this.env.DEMO_STUDIO_API_KEY;
      }

      container.start({
        image: desiredImage,
        instance: "standard-1",
        enableInternet: true,
        env,
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError;

    for (let attempt = 0; attempt < 150; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500),
        });
        await response.body?.cancel();

        if (response.ok) {
          await Promise.all([
            this.ctx.storage.put(ACTIVE_IMAGE_KEY, desiredImage),
            this.ctx.storage.put(ACTIVE_HYBRID_KEY, desiredHybrid),
          ]);
          return;
        }

        lastError = new Error("Health check returned " + response.status);
      } catch (error) {
        lastError = error;
      }

      await scheduler.wait(200);
    }

    throw new Error("Demo Studio container did not become ready.", {
      cause: lastError,
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      url.pathname === "/review/demo.mp4"
    ) {
      const object = await env.DEMO_STUDIO_ARTIFACTS.get(
        "review/plugin-walkthrough.mp4",
      );

      if (!object) {
        return new Response("Review demo is not available yet.", {
          status: 404,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      return new Response(request.method === "HEAD" ? null : object.body, {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(object.size),
          "Cache-Control": "public, max-age=3600",
          ETag: object.httpEtag,
        },
      });
    }

    const staticResponse = publicStaticResponse(request);
    if (staticResponse) return staticResponse;
    return env.DEMO_STUDIO.getByName("primary").fetch(request);
  },
};
