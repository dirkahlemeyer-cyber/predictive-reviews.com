import { AgentSession, AgentMicrophone, AgentPlayer } from "@deepgram/agents";

const startButton = /** @type {HTMLButtonElement} */ (document.querySelector("[data-voice-start]"));
const stopButton = /** @type {HTMLButtonElement} */ (document.querySelector("[data-voice-stop]"));
const status = /** @type {HTMLElement} */ (document.querySelector("[data-voice-status]"));
const transcript = /** @type {HTMLElement} */ (document.querySelector("[data-voice-transcript]"));
const agentPanel = /** @type {HTMLElement} */ (document.querySelector("[data-voice-agent]"));

if (!startButton || !stopButton || !status || !transcript || !agentPanel) {
  throw new Error("Voice agent controls are missing from this page.");
}

/** @type {AgentSession | undefined} */
let session;
/** @type {AgentMicrophone | undefined} */
let microphone;
/** @type {AgentPlayer | undefined} */
let player;

/** @param {string} message @param {string} [state] */
const setStatus = (message, state = "idle") => {
  status.textContent = message;
  status.dataset.state = state;
};

/** @param {string} role @param {string} content */
const addTranscript = (role, content) => {
  if (!content) return;
  const item = document.createElement("p");
  item.className = `voice-line voice-line--${role}`;
  const label = document.createElement("strong");
  label.textContent = `${role === "user" ? "Sie" : "Assistent"}: `;
  item.append(label, document.createTextNode(content));
  transcript.append(item);
  transcript.scrollTop = transcript.scrollHeight;
};

/** @param {boolean} running */
const setRunning = (running) => {
  startButton.hidden = running;
  stopButton.hidden = !running;
  agentPanel.classList.toggle("is-active", running);
};

async function startAgent() {
  if (session) return;
  setRunning(true);
  setStatus("Mikrofon wird angefragt …", "connecting");
  transcript.replaceChildren();

  try {
    session = new AgentSession({
      auth: {
        tokenFactory: async () => {
          const response = await fetch("/api/deepgram-token", { method: "POST", cache: "no-store" });
          if (!response.ok) throw new Error(await response.text());
          return response.text();
        },
      },
      audio: {
        input: { encoding: "linear16", sampleRate: 16000 },
        output: { encoding: "linear16", sampleRate: 24000 },
      },
      reconnect: { enabled: true, maxAttempts: 4, baseDelay: 700, maxDelay: 8000, jitter: true },
      agent: {
        language: "de",
        listen: {
          provider: { type: "deepgram", version: "v2", model: "flux-general-multi", language_hints: ["de"] },
        },
        think: {
          provider: { type: "open_ai", model: "gpt-4o-mini", temperature: 0.4 },
          prompt: "Du bist der freundliche Sprachassistent von Predictive Reviews. Sprich auf Deutsch, kurz und natürlich. Erkläre das Bewertungsmanagement, beantworte Fragen zu Leistungen und Ablauf und biete bei konkreten Anliegen ein Erstgespräch an. Behaupte keine garantierten Sterne, gekauften Bewertungen oder Ergebnisse. Wenn du etwas nicht weißt, sage das offen und verweise auf info@predictive-reviews.com oder +49 160 3773509.",
        },
        speak: {
          provider: { type: "deepgram", version: "v2", model: "flux-janine-de" },
        },
        greeting: "Guten Tag! Ich bin der Sprachassistent von Predictive Reviews. Wie kann ich Ihnen helfen?",
      },
    });

    player = new AgentPlayer({ sampleRate: 24000 });
    microphone = new AgentMicrophone((audio) => session?.sendAudio(audio), {
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });

    session.on("connected", () => setStatus("Verbunden – Sie können sprechen.", "connected"));
    session.on("reconnecting", () => setStatus("Verbindung wird wiederhergestellt …", "connecting"));
    session.on("disconnected", () => setStatus("Verbindung beendet.", "idle"));
    session.on("audio", (chunk) => player?.queue(chunk));
    session.on("user-started-speaking", () => player?.interrupt());
    session.on("agent-thinking", () => setStatus("Ich denke kurz nach …", "thinking"));
    session.on("agent-started-speaking", () => setStatus("Der Assistent spricht …", "speaking"));
    session.on("conversation-text", (message) => {
      addTranscript(message.role, message.content);
      if (message.role === "user") setStatus("Der Assistent hört zu …", "listening");
    });
    session.on("error", (message) => setStatus(message.description || "Deepgram meldet einen Fehler.", "error"));
    session.on("warning", (message) => console.warn("Deepgram warning", message));
    session.on("sdk-error", (error) => setStatus(error.message || "Sprachverbindung fehlgeschlagen.", "error"));

    await microphone.start();
    setStatus("Verbindung wird hergestellt …", "connecting");
    await session.connect();
  } catch (error) {
    console.error(error);
    setStatus(error instanceof Error ? error.message : "Sprachassistent konnte nicht gestartet werden.", "error");
    microphone?.stop();
    session?.disconnect();
    player?.dispose();
    session = undefined;
    microphone = undefined;
    player = undefined;
    setRunning(false);
  }
}

function stopAgent() {
  microphone?.stop();
  session?.disconnect();
  player?.dispose();
  session = undefined;
  microphone = undefined;
  player = undefined;
  setRunning(false);
  setStatus("Bereit für das nächste Gespräch.", "idle");
}

startButton?.addEventListener("click", startAgent);
stopButton?.addEventListener("click", stopAgent);
