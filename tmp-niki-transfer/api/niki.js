export default async function handler(req, res) {
  const { key, step } = req.query;
  if (!process.env.NIKI_TRANSFER_KEY || key !== process.env.NIKI_TRANSFER_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!step || !/^\d+$/.test(String(step))) {
    return res.status(400).json({ error: "invalid step" });
  }
  const urls = JSON.parse(process.env.NIKI_URLS_JSON || "{}");
  const source = urls[String(step)];
  if (!source) return res.status(404).json({ error: "unknown step" });
  const r = await fetch(source, { cache: "no-store" });
  if (!r.ok) return res.status(502).json({ error: "source fetch failed", status: r.status });
  const b = Buffer.from(await r.arrayBuffer());
  return res.status(200).json({ step: String(step), mime: r.headers.get("content-type") || "audio/mpeg", data: b.toString("base64") });
}
