export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).send("Method Not Allowed");
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return res.status(503).send("Deepgram ist derzeit nicht konfiguriert.");
  }

  try {
    const response = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 60 }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.access_token) {
      console.error("Deepgram token error", response.status, typeof payload?.err_code === "string" ? payload.err_code : "unknown");
      return res.status(502).send("Deepgram-Token konnte nicht erstellt werden.");
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(payload.access_token);
  } catch (error) {
    console.error("Deepgram token request failed", error);
    return res.status(502).send("Deepgram ist momentan nicht erreichbar.");
  }
}
