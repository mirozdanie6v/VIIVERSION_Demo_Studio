function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildJobStatusPage(jobId: string): string {
  const id = escapeHtml(jobId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Demo Studio job ${id}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #090b10; color: #f5f7fb; }
    main { max-width: 760px; margin: 0 auto; padding: 56px 24px 88px; }
    .muted { color: #9ea6b8; }
    .card { background:#11151d; border:1px solid #282d38; border-radius:18px; padding:22px; margin-top:20px; }
    .bar { height:14px; border-radius:999px; background:#222733; overflow:hidden; margin:18px 0 10px; }
    .fill { height:100%; width:0%; background:linear-gradient(90deg,#9a7cff,#54d5ff); transition:width .35s ease; }
    .row { display:flex; gap:16px; flex-wrap:wrap; margin-top:14px; }
    .pill { border:1px solid #343a48; border-radius:999px; padding:7px 11px; font-size:13px; color:#dbe0ea; }
    .history { margin:0; padding:0; list-style:none; }
    .history li { padding:10px 0; border-top:1px solid #242a34; color:#c9ced8; }
    .error { color:#ffb0b0; white-space:pre-wrap; }
    a { color:#b7c9ff; }
    code { word-break:break-all; }
  </style>
</head>
<body>
  <main>
    <div class="muted">VIIVERSION · Demo Studio</div>
    <h1>Generation progress</h1>
    <div class="card">
      <div id="stage">Loading…</div>
      <div class="bar"><div class="fill" id="fill"></div></div>
      <div id="percent">0%</div>
      <p id="message" class="muted">Connecting to job status…</p>
      <div class="row">
        <span class="pill" id="attempt">Attempt —</span>
        <span class="pill" id="elapsed">Stage —</span>
        <span class="pill" id="heartbeat">Heartbeat —</span>
      </div>
      <p id="retry" class="muted"></p>
      <p id="error" class="error"></p>
      <p id="artifact"></p>
    </div>
    <div class="card">
      <strong>Recent activity</strong>
      <ul id="history" class="history"></ul>
    </div>
    <p class="muted">Job ID: <code>${id}</code></p>
  </main>
<script>
const jobId = ${JSON.stringify(jobId)};
const endpoint = "/v1/jobs/" + encodeURIComponent(jobId);
const $ = (id) => document.getElementById(id);

function seconds(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
}

function render(job) {
  $("stage").textContent = job.stageLabel || job.stage || job.status;
  $("fill").style.width = Math.max(0, Math.min(100, job.progress || 0)) + "%";
  $("percent").textContent = (job.progress || 0) + "%";
  $("message").textContent = job.message || "";
  $("attempt").textContent = "Attempt " + (job.attempt || 1) + "/" + (job.maxAttempts || 1);

  const elapsed = seconds(job.stageStartedAt);
  const heartbeat = seconds(job.heartbeatAt);
  $("elapsed").textContent = "Stage " + elapsed + "s";
  $("heartbeat").textContent = "Heartbeat " + heartbeat + "s ago";

  $("retry").textContent = job.retryReason
    ? "Automatic recovery: " + job.retryReason
    : "";
  $("error").textContent = job.error || "";

  const artifact = $("artifact");
  if (job.artifact_url || job.artifactReady) {
    const href = job.artifact_url || (endpoint + "/artifact");
    artifact.innerHTML = '<a href="' + href + '">Open final MP4</a>';
  } else {
    artifact.textContent = "";
  }

  const history = $("history");
  history.innerHTML = "";
  for (const item of (job.history || []).slice().reverse()) {
    const li = document.createElement("li");
    li.textContent =
      new Date(item.at).toLocaleTimeString() +
      " · " +
      (item.stage || item.status) +
      " · " +
      item.progress +
      "% · " +
      item.message;
    history.appendChild(li);
  }

  if (job.status === "completed" || job.status === "failed") {
    return false;
  }
  return true;
}

async function poll() {
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Status request returned HTTP " + response.status);
    const job = await response.json();
    const keepGoing = render(job);
    if (keepGoing) setTimeout(poll, 2000);
  } catch (error) {
    $("message").textContent = "Connection problem. Retrying automatically…";
    $("error").textContent = String(error && error.message ? error.message : error);
    setTimeout(poll, 3000);
  }
}
poll();
</script>
</body>
</html>`;
}
