export const LANDING_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#08090d" />
  <title>VIIVERSION Demo Studio</title>
  <meta name="description" content="Turn a web application into a polished product demo video." />
  <style>
    :root {
      color-scheme: dark;
      --bg:#07080b;
      --panel:rgba(255,255,255,.065);
      --line:rgba(255,255,255,.12);
      --text:#f7f8fb;
      --muted:#a5a9b6;
      --accent:#9a7cff;
      --accent2:#54d5ff;
      --ok:#64e7a4;
    }
    * { box-sizing:border-box; }
    html { background:var(--bg); }
    body {
      margin:0;
      min-height:100svh;
      color:var(--text);
      font-family:Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 18% -10%, rgba(130,94,255,.28), transparent 34%),
        radial-gradient(circle at 90% 18%, rgba(56,193,255,.18), transparent 30%),
        linear-gradient(180deg,#0a0b10 0%,#07080b 100%);
    }
    a { color:inherit; }
    .shell { width:min(1120px,calc(100% - 32px)); margin:0 auto; }
    header {
      height:72px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      border-bottom:1px solid var(--line);
    }
    .brand { display:flex; align-items:center; gap:12px; font-weight:750; letter-spacing:.02em; }
    .mark {
      width:34px; height:34px; border-radius:11px;
      background:linear-gradient(135deg,var(--accent),var(--accent2));
      box-shadow:0 0 36px rgba(126,101,255,.35);
    }
    .status {
      display:flex; align-items:center; gap:8px;
      color:var(--muted); font-size:13px;
    }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--ok); box-shadow:0 0 16px rgba(100,231,164,.7); }
    main { padding:68px 0 52px; }
    .eyebrow { color:#c6b9ff; font-size:13px; font-weight:700; letter-spacing:.16em; text-transform:uppercase; }
    h1 {
      max-width:900px;
      margin:16px 0 20px;
      font-size:clamp(44px,8vw,92px);
      line-height:.94;
      letter-spacing:-.055em;
    }
    .lead {
      max-width:720px;
      margin:0;
      color:var(--muted);
      font-size:clamp(18px,2.4vw,22px);
      line-height:1.55;
    }
    .actions { display:flex; gap:12px; flex-wrap:wrap; margin-top:32px; }
    .button {
      display:inline-flex; align-items:center; justify-content:center;
      min-height:48px; padding:0 18px; border-radius:14px;
      text-decoration:none; font-weight:700; border:1px solid var(--line);
      background:rgba(255,255,255,.07);
    }
    .button.primary {
      border:0;
      background:linear-gradient(135deg,#8669ff,#55cfff);
      color:#07080b;
    }
    .grid {
      display:grid; grid-template-columns:repeat(3,minmax(0,1fr));
      gap:14px; margin-top:58px;
    }
    .card {
      min-height:190px;
      padding:22px;
      border:1px solid var(--line);
      border-radius:22px;
      background:var(--panel);
      backdrop-filter:blur(18px);
    }
    .card strong { display:block; font-size:18px; margin-bottom:10px; }
    .card p { margin:0; color:var(--muted); line-height:1.55; }
    .endpoint {
      margin-top:16px;
      padding:11px 12px;
      border-radius:11px;
      border:1px solid var(--line);
      background:rgba(0,0,0,.24);
      color:#dfe2ea;
      font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;
      overflow-wrap:anywhere;
    }
    footer {
      margin-top:48px;
      padding:24px 0 36px;
      color:#6f7482;
      border-top:1px solid var(--line);
      font-size:13px;
    }
    @media (max-width:780px) {
      header { height:64px; }
      main { padding-top:46px; }
      .grid { grid-template-columns:1fr; margin-top:42px; }
      .card { min-height:0; }
      .status span:last-child { display:none; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="brand"><span class="mark" aria-hidden="true"></span>VIIVERSION Demo Studio</div>
      <div class="status"><span class="dot"></span><span>Production online</span></div>
    </header>

    <main>
      <div class="eyebrow">AI product presentation engine</div>
      <h1>Turn a web app into a presentation video.</h1>
      <p class="lead">
        Demo Studio inspects an interface, executes the demo flow in a real browser,
        applies presentation motion and scene-aware editing, then renders a polished MP4.
      </p>

      <div class="actions">
        <a class="button primary" href="/health">Check service</a>
        <a class="button" href="/openapi.json">Open API specification</a>
      </div>

      <section class="grid" aria-label="Capabilities">
        <article class="card">
          <strong>Inspect</strong>
          <p>Reads visible application structure and identifies stable interactive targets for a reproducible demo scenario.</p>
          <div class="endpoint">MCP: inspect_web_app</div>
        </article>
        <article class="card">
          <strong>Capture & direct</strong>
          <p>Runs Playwright, follows the scenario, highlights clicks, focuses important UI and records the browser session.</p>
          <div class="endpoint">MCP: create_demo_video_from_scenario</div>
        </article>
        <article class="card">
          <strong>Render</strong>
          <p>Builds scene-aware cuts, captions, VIIVERSION branding, intro/outro and exports H.264 video.</p>
          <div class="endpoint">MCP endpoint: /mcp</div>
        </article>
      </section>
    </main>

    <footer>VIIVERSION · Demo Studio · demostudio.viiversion.com</footer>
  </div>
</body>
</html>`;

export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#9a7cff"/><stop offset="1" stop-color="#54d5ff"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="#08090d"/><path d="M16 17h10l6 14 6-14h10L34.5 47h-5z" fill="url(#g)"/></svg>`;
