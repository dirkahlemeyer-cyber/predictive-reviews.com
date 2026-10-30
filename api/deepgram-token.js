import { clientIp, limitConfig, reserveVoiceSlot, releaseVoiceSlot } from "./voice-limit.js";

/**
 * @param {{ method?: string, headers?: { [key: string]: string | string[] | undefined } }} req
 * @param {{ setHeader: (name: string, value: string) => void, status: (code: number) => { send: (body: string) => void } }} res
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  // This limits cross-site browser calls. Provider-side usage limits are
  // still needed because the public endpoint can be called by other clients.
  if (!req.headers?.origin || !req.headers?.host ||
      req.headers.origin !== `https://${req.headers.host}`) {
    return res.status(403).send("Forbidden");
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(503).send("Deepgram ist derzeit nicht konfiguriert.");
  }

  const config = limitConfig(process.env);
  const ip = clientIp(req.headers);
  if (!config || !ip) {
    return res.status(503).send("Sprachassistent ist momentan nicht verfügbar.");
  }

  let slot;
  try {
    slot = await reserveVoiceSlot(ip, config);
  } catch {
    console.error("Voice rate-limit storage unavailable");
    return res.status(503).send("Sprachassistent ist momentan nicht verfügbar.");
  }
  if (!slot.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, slot.retryAfter)));
    return res.status(429).send("Die Gesprächsgrenze für diese Verbindung ist erreicht.");
  }

  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
      signal: AbortSignal.timeout(8000),
    });

    const payload = await response.json();
    if (!response.ok || !payload.access_token) {
      console.error("Deepgram token error", response.status, typeof payload?.err_code === "string" ? payload.err_code : "unknown");
      try { await releaseVoiceSlot(config, slot); } catch { console.error("Voice slot release failed"); }
      return res.status(502).send("Deepgram-Token konnte nicht erstellt werden.");
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(payload.access_token);
  } catch {
    console.error("Deepgram token request failed");
    try { await releaseVoiceSlot(config, slot); } catch { console.error("Voice slot release failed"); }
    return res.status(502).send("Deepgram ist momentan nicht erreichbar.");
  }
}
