import { AgentSession, AgentMicrophone, AgentPlayer } from "@deepgram/agents";

const starts = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("[data-voice-start]"));
const stops = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll("[data-voice-stop]"));
const status = /** @type {HTMLElement} */ (document.querySelector("[data-voice-status]"));
const transcript = /** @type {HTMLElement} */ (document.querySelector("[data-voice-transcript]"));
const panel = /** @type {HTMLElement} */ (document.querySelector("[data-voice-agent]"));
const dock = /** @type {HTMLElement} */ (document.querySelector("[data-voice-dock]"));
const dockStatus = /** @type {HTMLElement} */ (document.querySelector("[data-voice-dock-status]"));
const time = /** @type {HTMLElement} */ (document.querySelector("[data-voice-time]"));
const dockTime = /** @type {HTMLElement} */ (document.querySelector("[data-voice-dock-time]"));

if (!starts.length || !stops.length || !status || !transcript || !panel ||
    !dock || !dockStatus || !time || !dockTime) {
  throw new Error("Voice agent controls are missing from this page.");
}

/** @typedef {{ controller: AbortController, session?: AgentSession, microphone?: AgentMicrophone, player?: AgentPlayer, deadline?: number, connectTimeout?: ReturnType<typeof setTimeout>, timeout?: ReturnType<typeof setTimeout>, ticker?: ReturnType<typeof setInterval> }} VoiceRun */
/** @type {VoiceRun | undefined} */
let activeRun;

/** @param {string} message @param {string} [state] */
function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
  dockStatus.textContent = message;
}

/** @param {string} role @param {string} content */
function addTranscript(role, content) {
  if (!content) return;
  const item = document.createElement("p");
  item.className = `voice-line voice-line--${role}`;
  const label = document.createElement("strong");
  label.textContent = `${role === "user" ? "Sie" : "Assistent"}: `;
  item.append(label, document.createTextNode(content));
  transcript.append(item);
  transcript.scrollTop = transcript.scrollHeight;
}

/** @param {boolean} running */
function setRunning(running) {
  starts.forEach((button) => { button.hidden = running; });
  stops.forEach((button) => { button.hidden = !running; });
  dock.hidden = !running;
  time.hidden = !running;
  panel.classList.toggle("is-active", running);
}

/** @param {VoiceRun} run */
function updateClock(run) {
  if (activeRun !== run || !run.deadline) return;
  const remaining = Math.max(0, Math.ceil((run.deadline - Date.now()) / 1000));
  const display = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  time.textContent = display;
  dockTime.textContent = display;
  if (remaining === 0) stopAgent("Das Gespräch wurde nach 3 Minuten beendet.");
}

/** @param {string} [message] @param {string} [state] */
function stopAgent(message = "Gespräch beendet.", state = "idle") {
  const run = activeRun;
  if (!run) return;
  activeRun = undefined;
  run.controller.abort();
  clearTimeout(run.connectTimeout);
  clearTimeout(run.timeout);
  clearInterval(run.ticker);
  run.microphone?.stop();
  run.session?.disconnect();
  run.player?.dispose();
  setRunning(false);
  setStatus(message, state);
}

/** @param {Response} response */
function tokenError(response) {
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(seconds) && seconds > 0) {
      const hours = Math.ceil(seconds / 3600);
      const minutes = Math.ceil(seconds / 60);
      return `Gesprächsgrenze erreicht. Bitte in etwa ${hours > 1 ? `${hours} Stunden` : `${minutes} Minuten`} erneut versuchen.`;
    }
    return "Gesprächsgrenze erreicht. Bitte später erneut versuchen.";
  }
  if (response.status === 503) return "Sprachassistent ist momentan nicht verfügbar.";
  return "Sprachassistent konnte nicht gestartet werden.";
}

async function startAgent() {
  if (activeRun) return;
  /** @type {VoiceRun} */
  const run = { controller: new AbortController() };
  activeRun = run;
  setRunning(true);
  setStatus("Mikrofon wird angefragt …", "connecting");
  time.textContent = "03:00";
  dockTime.textContent = "03:00";
  transcript.replaceChildren();
  run.connectTimeout = setTimeout(() => {
    if (activeRun === run && !run.deadline) stopAgent("Die Verbindung konnte nicht rechtzeitig hergestellt werden.", "error");
  }, 45000);

  try {
    run.session = new AgentSession({
      auth: {
        tokenFactory: async () => {
          const response = await fetch("/api/deepgram-token", {
            method: "POST", cache: "no-store", signal: run.controller.signal,
          });
          if (!response.ok) throw new Error(tokenError(response));
          return response.text();
        },
      },
      audio: {
        input: { encoding: "linear16", sampleRate: 16000 },
        output: { encoding: "linear16", sampleRate: 24000 },
      },
      reconnect: { enabled: false },
      agent: {
        listen: {
          provider: { type: "deepgram", version: "v2", model: "flux-general-multi", language_hints: ["de"] },
        },
        think: {
          provider: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.4 },
          prompt: "Du bist der freundliche Sprachassistent von Predictive Reviews. Sprich auf Deutsch, kurz und natürlich. Erkläre das Bewertungsmanagement, beantworte Fragen zu Leistungen und Ablauf und biete bei konkreten Anliegen ein Erstgespräch an. Behaupte keine garantierten Sterne, gekauften Bewertungen oder Ergebnisse. Wenn du etwas nicht weißt, sage das offen und verweise auf info@predictive-reviews.com oder +49 160 3773509.",
        },
        speak: { provider: { type: "deepgram", version: "v2", model: "flux-janine-de" } },
        greeting: "Guten Tag! Ich bin der Sprachassistent von Predictive Reviews. Wie kann ich Ihnen helfen?",
      },
    });

    run.player = new AgentPlayer({ sampleRate: 24000 });
    run.microphone = new AgentMicrophone((audio) => run.session?.sendAudio(audio), {
      sampleRate: 16000,
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    });

    run.session.on("connected", () => {
      if (activeRun !== run) return;
      clearTimeout(run.connectTimeout);
      if (!run.deadline) {
        run.deadline = Date.now() + 180000;
        run.timeout = setTimeout(() => stopAgent("Das Gespräch wurde nach 3 Minuten beendet."), 180000);
        run.ticker = setInterval(() => updateClock(run), 1000);
      }
      setStatus("Verbunden – Sie können sprechen.", "connected");
    });
    run.session.on("reconnecting", () => { if (activeRun === run) setStatus("Verbindung wird wiederhergestellt …", "connecting"); });
    run.session.on("disconnected", () => { if (activeRun === run) stopAgent("Verbindung beendet."); });
    run.session.on("audio", (chunk) => { if (activeRun === run) run.player?.queue(chunk); });
    run.session.on("user-started-speaking", () => { if (activeRun === run) run.player?.interrupt(); });
    run.session.on("agent-thinking", () => { if (activeRun === run) setStatus("Ich denke kurz nach …", "thinking"); });
    run.session.on("agent-started-speaking", () => { if (activeRun === run) setStatus("Der Assistent spricht …", "speaking"); });
    run.session.on("conversation-text", (message) => {
      if (activeRun !== run) return;
      addTranscript(message.role, message.content);
      if (message.role === "user") setStatus("Der Assistent hört zu …", "listening");
    });
    run.session.on("error", (message) => { if (activeRun === run) stopAgent(message.description || "Sprachverbindung fehlgeschlagen.", "error"); });
    run.session.on("sdk-error", (error) => { if (activeRun === run) stopAgent(error.message || "Sprachverbindung fehlgeschlagen.", "error"); });

    await run.microphone.start();
    if (activeRun !== run) { run.microphone.stop(); return; }
    setStatus("Verbindung wird hergestellt …", "connecting");
    await run.session.connect();
    if (activeRun !== run) run.session.disconnect();
  } catch (error) {
    if (activeRun !== run) return;
    stopAgent(error instanceof Error ? error.message : "Sprachassistent konnte nicht gestartet werden.", "error");
  }
}

starts.forEach((button) => button.addEventListener("click", startAgent));
stops.forEach((button) => button.addEventListener("click", () => stopAgent()));
window.addEventListener("pagehide", () => stopAgent());
