import * as webllm from "https://esm.run/@mlc-ai/web-llm";


const STORAGE_KEY = "jarvis-web-state-v1";
const DEFAULT_MODEL = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const SYSTEM_PROMPT = [
  "You are Jarvis, a helpful AI assistant.",
  "Be accurate, clear, and honest.",
  "If you are not sure or if the answer could be outdated, say that clearly instead of making things up.",
  "When helpful, structure the answer with short sections or steps.",
].join(" ");


const MODEL_OPTIONS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    note: "Fastest start",
  },
  {
    id: "Llama-3.1-8B-Instruct-q4f32_1-MLC",
    label: "Llama 3.1 8B",
    note: "Deeper answers",
  },
];

const dom = {
  micBtn: document.querySelector("#micBtn"),
  clearChatBtn: document.querySelector("#clearChatBtn"),
  deleteChatBtn: document.querySelector("#deleteChatBtn"),
  compatibilityBanner: document.querySelector("#compatibilityBanner"),
  composerForm: document.querySelector("#composerForm"),
  heroPanel: document.querySelector("#heroPanel"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  messageList: document.querySelector("#messageList"),
  modelSelect: document.querySelector("#modelSelect"),
  newChatBtn: document.querySelector("#newChatBtn"),
  promptInput: document.querySelector("#promptInput"),
  runtimeHint: document.querySelector("#runtimeHint"),
  sendBtn: document.querySelector("#sendBtn"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  tokenHint: document.querySelector("#tokenHint"),
};

const state = {
  activeConversationId: "",
  availableModels: MODEL_OPTIONS,
  engine: null,
  isGenerating: false,
  modelReadyFor: "",
  selectedModel: DEFAULT_MODEL,
  conversations: [],
};
let activeSpeech = null;

let typingCursorInterval = null;

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function createConversation(seedGreeting = true) {
  const conversation = {
    id: uid("chat"),
    title: "New chat",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: seedGreeting
      ? [
          {
            id: uid("msg"),
            role: "assistant",
            content:
              "Hello, I'm Jarvis. Ask me anything, and I'll answer using the local browser model once it finishes loading.",
            createdAt: nowIso(),
          },
        ]
      : [],
  };
  state.conversations.unshift(conversation);
  state.activeConversationId = conversation.id;
  persistState();
  return conversation;
}

function getActiveConversation() {
  return state.conversations.find((item) => item.id === state.activeConversationId) ?? null;
}

function persistState() {
  const snapshot = {
    activeConversationId: state.activeConversationId,
    conversations: state.conversations,
    selectedModel: state.selectedModel,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      createConversation(true);
      return;
    }

    const parsed = JSON.parse(raw);
    state.selectedModel = parsed.selectedModel || DEFAULT_MODEL;
    state.conversations = Array.isArray(parsed.conversations) ? parsed.conversations : [];
    state.activeConversationId = parsed.activeConversationId || "";

    if (!state.conversations.length) {
      createConversation(true);
      return;
    }

    const activeExists = state.conversations.some((item) => item.id === state.activeConversationId);
    if (!activeExists) {
      state.activeConversationId = state.conversations[0].id;
    }
  } catch (error) {
    console.error("Failed to restore Jarvis state:", error);
    state.conversations = [];
    createConversation(true);
  }
}

function setStatus(mode, text) {
  dom.statusDot.className = `status-dot ${mode}`;
  dom.statusText.textContent = text;
}

function setBanner(message = "") {
  if (!message) {
    dom.compatibilityBanner.textContent = "";
    dom.compatibilityBanner.classList.add("hidden");
    return;
  }
  dom.compatibilityBanner.textContent = message;
  dom.compatibilityBanner.classList.remove("hidden");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderFormattedText(content) {
  const segments = content.split(/```/g);
  return segments
    .map((segment, index) => {
      if (index % 2 === 1) {
        const lines = segment.replace(/^\n+|\n+$/g, "").split("\n");
        const maybeLang = lines[0]?.trim();
        const language = maybeLang && /^[a-zA-Z0-9_+-]+$/.test(maybeLang) ? maybeLang : "";
        const codeBody = language ? lines.slice(1).join("\n") : lines.join("\n");
        return `<pre><code>${escapeHtml(codeBody)}</code></pre>`;
      }

      return segment
        .trim()
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph) => {
          const safe = escapeHtml(paragraph)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\n/g, "<br>");
          return `<p>${safe}</p>`;
        })
        .join("");
    })
    .join("");
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateLabel(iso) {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function summarizeTitle(content) {
  return content.replace(/\s+/g, " ").trim().slice(0, 40) || "New chat";
}

function updateConversationTitle(conversation) {
  const firstUser = conversation.messages.find((item) => item.role === "user");
  conversation.title = firstUser ? summarizeTitle(firstUser.content) : "New chat";
}

function renderHistory() {
  dom.historyCount.textContent = String(state.conversations.length);

  if (!state.conversations.length) {
    dom.historyList.innerHTML = '<div class="empty-history">No chats yet</div>';
    return;
  }

  dom.historyList.innerHTML = state.conversations
    .map((conversation) => {
      const active = conversation.id === state.activeConversationId ? "active" : "";
      return `
        <button class="history-item ${active}" type="button" data-chat-id="${conversation.id}">
          <span class="history-item-title">${escapeHtml(conversation.title)}</span>
          <span class="history-item-date">${formatDateLabel(conversation.updatedAt)}</span>
        </button>
      `;
    })
    .join("");
}

function renderEmptyState() {
  dom.messageList.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-card">
        <h3>Jarvis is ready when you are.</h3>
        <p>
          Send a message to start a conversation. On the first prompt, Jarvis downloads
          and loads the selected local model into your browser cache.
        </p>
      </div>
    </div>
  `;
}

function renderMessages() {
  const conversation = getActiveConversation();
  if (!conversation || !conversation.messages.length) {
    renderEmptyState();
    dom.heroPanel.classList.remove("hidden");
    return;
  }

  dom.heroPanel.classList.add("hidden");
  dom.messageList.innerHTML = conversation.messages
    .map((message) => {
      const isAssistant = message.role === "assistant";
      const body =
  isAssistant && !message.content
    ? '<div class="typing"><span></span><span></span><span></span></div>'
    : message.content.includes("<img")
      ? message.content
      :renderFormattedText(message.content) +
(
  state.isGenerating &&
  isAssistant &&
  message === getActiveConversation()?.messages.at(-1)
    ? '<span class="typing-dot"></span>'
    : ""
)
      return `
        <article class="message-row ${message.role}">
          <div class="bubble">
            <div class="bubble-head">
              <span class="bubble-role">
                <span class="bubble-role-dot ${message.role}"></span>
                ${isAssistant ? "Jarvis" : "You"}
              </span>
              <span class="bubble-time">${formatTime(message.createdAt)}</span>
            </div>
            <div class="bubble-body">${body}</div>
          </div>
        </article>
      `;
    })
    .join("");

  dom.messageList.scrollTop = dom.messageList.scrollHeight;
}

function syncModelSelect() {
  const modelIds = new Set(webllm.prebuiltAppConfig?.model_list?.map((model) => model.model_id) || []);
  const filteredModels = MODEL_OPTIONS.filter((model) => modelIds.size === 0 || modelIds.has(model.id));
  state.availableModels = filteredModels.length ? filteredModels : MODEL_OPTIONS;

  if (!state.availableModels.some((model) => model.id === state.selectedModel)) {
    state.selectedModel = state.availableModels[0]?.id || DEFAULT_MODEL;
  }

  dom.modelSelect.innerHTML = state.availableModels.map(
    (model) => `<option value="${model.id}">${model.label} - ${model.note}</option>`,
  ).join("");
  dom.modelSelect.value = state.selectedModel;
}

function autoResizeTextarea() {
  dom.promptInput.style.height = "auto";
  dom.promptInput.style.height = `${Math.min(dom.promptInput.scrollHeight, 192)}px`;
}

function addMessage(role, content) {
  const conversation = getActiveConversation() ?? createConversation(false);
  const message = {
    id: uid("msg"),
    role,
    content,
    createdAt: nowIso(),
  };

  conversation.messages.push(message);
  conversation.updatedAt = nowIso();
  updateConversationTitle(conversation);
  state.conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  persistState();
  renderHistory();
  renderMessages();
  return message;
}

function buildPromptMessages() {
  const conversation = getActiveConversation();
  const payload = [{ role: "system", content: SYSTEM_PROMPT }];

  if (!conversation) {
    return payload;
  }

  for (const message of conversation.messages) {
    if (message.role !== "assistant" && message.role !== "user") {
      continue;
    }
    if (!message.content?.trim()) {
      continue;
    }
    payload.push({ role: message.role, content: message.content });
  }

  return payload;
}

function describeProgress(progress) {
  if (!progress) {
    return "Loading model";
  }

  if (typeof progress === "string") {
    return progress;
  }

  const text = progress.text || progress.status || "Loading model";
  const ratio = typeof progress.progress === "number" ? ` ${Math.round(progress.progress * 100)}%` : "";
  return `${text}${ratio}`;
}

async function ensureEngine() {
  if (!("gpu" in navigator)) {
    const message =
      "This browser does not expose WebGPU, so the local Jarvis model cannot start here. Open the app in a recent Chrome or Edge build and run it through a local server.";
    setStatus("error", "WebGPU is unavailable");
    setBanner(message);
    throw new Error(message);
  }

  if (state.engine && state.modelReadyFor === state.selectedModel) {
    return state.engine;
  }

  setBanner("");
  setStatus("loading", "Loading Jarvis model");
  dom.runtimeHint.textContent = "Loading the local AI model. First run can take a while.";

  if (!state.engine) {
    const worker = new Worker(new URL("./llm-worker.js", import.meta.url), { type: "module" });
    state.engine = await webllm.CreateWebWorkerMLCEngine(worker, state.selectedModel, {
      initProgressCallback: (progress) => {
        setStatus("loading", describeProgress(progress));
      },
    });
  } else {
    await state.engine.reload(state.selectedModel);
  }

  state.modelReadyFor = state.selectedModel;
  dom.runtimeHint.textContent = "Jarvis is loaded locally in your browser.";
  setStatus("ready", "Jarvis is ready");
  return state.engine;
}
async function handleSend(event) {
  event?.preventDefault();

  if (state.isGenerating) {
    return;
  }

  const text = dom.promptInput.value.trim();

  if (!text) {
    return;
  }

  dom.promptInput.value = "";
  autoResizeTextarea();

  addMessage("user", text);

  // IMAGE GENERATION
if (
  text.toLowerCase().startsWith("generate image") ||
  text.toLowerCase().startsWith("make image") ||
  text.toLowerCase().startsWith("create image")
) {
  state.isGenerating = true;

  dom.sendBtn.disabled = true;

  try {
    setStatus("loading", "Generating image");

    const loadingMessage = addMessage(
      "assistant",
      "Generating image..."
    );

    // Better prompt cleanup
    const imagePrompt = text
      .replace(/^generate image/i, "")
      .replace(/^make image/i, "")
      .replace(/^create image/i, "")
      .trim();

    // Timeout controller
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 120000);

    const response = await fetch(
      "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer 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",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: imagePrompt,
        }),
        signal: controller.signal,
      }
    );
    // ADD THESE HERE
console.log("STATUS:", response.status);
console.log(
  "CONTENT TYPE:",
  response.headers.get("content-type")
);

    clearTimeout(timeout);

    if (!response.ok) {
      let errorText = "";

      try {
        errorText = await response.text();
      } catch {}

      throw new Error(
        `Image API failed (${response.status}) ${errorText}`
      );
    }

    const contentType = response.headers.get("content-type");

    if (!contentType || !contentType.startsWith("image/")) {
      throw new Error("API did not return an image");
    }
    const blob = await response.blob();

// Convert image to permanent Base64 URL
const imageUrl = await new Promise((resolve) => {
  const reader = new FileReader();

  reader.onloadend = () => resolve(reader.result);

  reader.readAsDataURL(blob);
});

    loadingMessage.content = `
  <div class="generated-image-wrapper">

    <p>Generated image:</p>

    <img 
      src="${imageUrl}" 
      class="generated-image"
      alt="Generated AI image"
    >

    <div class="image-actions">
      <button
        class="download-image-btn"
        onclick="downloadGeneratedImage('${imageUrl}')"
      >
        Download Image
      </button>
    </div>

  </div>
`;

    loadingMessage.createdAt = nowIso();

    // IMPORTANT
    persistState();

    renderMessages();

    setStatus("ready", "Image generated");

    dom.tokenHint.textContent = "AI image generated successfully";
  } catch (error) {
    console.error("FULL ERROR:", error);
alert(error.message);
    let errorMessage = "Failed to generate image.";

    if (error.name === "AbortError") {
      errorMessage = "Image generation timed out.";
    }
    addMessage(
      "assistant",
      errorMessage
    );

    setStatus("error", "Image generation failed");

    dom.tokenHint.textContent = "Image generation error";
  } finally {
    state.isGenerating = false;

    dom.sendBtn.disabled = false;
  }

  return;
}

  // NORMAL AI CHAT
  const promptMessages = buildPromptMessages();

  const replyMessage = addMessage("assistant", "");

  dom.sendBtn.disabled = true;
  dom.modelSelect.disabled = true;
  dom.clearChatBtn.disabled = true;
  dom.newChatBtn.disabled = true;

  state.isGenerating = true;

  setStatus("loading", "Jarvis is thinking");

  dom.tokenHint.textContent = "Generating streamed reply";

  try {
    const engine = await ensureEngine();

    const stream = await engine.chat.completions.create({
      messages: promptMessages,
      max_tokens: 700,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.6,
      top_p: 0.9,
    });

    let usageText = "Streaming responses enabled";

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";

    if (delta) {
  // Smooth typing animation
  for (const char of delta) {
    replyMessage.content += char;

    renderMessages();

    await new Promise((resolve) =>
      setTimeout(resolve, 8)
    );
  }
}

      if (chunk.usage) {
        const total = chunk.usage.total_tokens ?? "?";
        usageText = `Last response used ${total} tokens`;
      }
    }

    replyMessage.content =
      replyMessage.content.trim() ||
      "I couldn't generate a response for that prompt.";

    replyMessage.createdAt = nowIso();

    dom.tokenHint.textContent = usageText;

    setStatus("ready", "Jarvis is ready");
    speakText(replyMessage.content);
  } catch (error) {
  console.error(error);

  state.isGenerating = false;

  replyMessage.content =
    "I hit a startup or generation problem.";
    dom.tokenHint.textContent = "Generation error";

    setStatus("error", "Jarvis hit an error");

    setBanner(error.message || "Jarvis could not start.");
  } finally {
    const conversation = getActiveConversation();

    if (conversation) {
      conversation.updatedAt = nowIso();
      updateConversationTitle(conversation);
    }

    persistState();

    renderHistory();
    renderMessages();

    dom.sendBtn.disabled = false;
    dom.modelSelect.disabled = false;
    dom.clearChatBtn.disabled = false;
    dom.newChatBtn.disabled = false;

    state.isGenerating = false;
  }
}
function startNewChat() {
  createConversation(false);
  renderHistory();
  renderMessages();
  dom.promptInput.focus();
}

function clearCurrentChat() {
  const conversation = getActiveConversation();
  if (!conversation || state.isGenerating) {
    return;
  }
  conversation.messages = [];
  conversation.updatedAt = nowIso();
  conversation.title = "New chat";
  persistState();
  renderHistory();
  renderMessages();
}

function switchConversation(id) {
  if (state.isGenerating) {
    return;
  }
  state.activeConversationId = id;
  persistState();
  renderHistory();
  renderMessages();
}

function deleteCurrentChat() {
  if (state.isGenerating) {
    return;
  }

  const conversation = getActiveConversation();

  if (!conversation) {
    return;
  }

  // Delete current chat
  state.conversations = state.conversations.filter(
    (chat) => chat.id !== conversation.id
  );

  // If all chats are deleted, create a new empty one
  if (state.conversations.length === 0) {
    createConversation(false);
  } else {
    // Switch to first remaining chat
    state.activeConversationId = state.conversations[0].id;
  }

  persistState();
  renderHistory();
  renderMessages();
}
let recognition = null;
let speechEnabled = false;

function initSpeechRecognition() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    console.warn("Speech recognition not supported");
    return;
  }

  recognition = new SpeechRecognition();

  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = "en-US";

  speechEnabled = true;

  recognition.onstart = () => {
    dom.micBtn.classList.add("recording");

    setStatus("loading", "Listening...");
  };

  recognition.onend = () => {
  dom.micBtn.classList.remove("recording");

  if (!state.isGenerating) {
    setStatus("idle", "Tap mic to speak");
  }
};
  recognition.onerror = (event) => {
    console.error("Speech recognition error:", event.error);

    dom.micBtn.classList.remove("recording");

    setStatus("error", "Speech recognition failed");
  };

  recognition.onresult = (event) => {
  let transcript = "";

  for (let i = 0; i < event.results.length; i++) {
    transcript += event.results[i][0].transcript;
  }

  dom.promptInput.value = transcript.trim();

  autoResizeTextarea();

  // Auto send when speech is final
  const lastResult =
    event.results[event.results.length - 1];

  if (lastResult.isFinal) {
    setStatus("loading", "Sending message...");

    setTimeout(() => {
      handleSend();
    }, 300);
  }
};
}

function speakText(text) {
  if (document.hidden) return;
  if (!("speechSynthesis" in window)) {
    return;
  }

  // Stop previous speech
  speechSynthesis.cancel();

  activeSpeech = new SpeechSynthesisUtterance(text);

  activeSpeech.rate = 1;
  activeSpeech.pitch = 1;
  activeSpeech.volume = 1;

  // Optional better voice
  const voices = speechSynthesis.getVoices();

  const preferred =
    voices.find((v) =>
      v.name.toLowerCase().includes("google")
    ) || voices[0];

  if (preferred) {
    activeSpeech.voice = preferred;
  }

  speechSynthesis.speak(activeSpeech);
}
function bindEvents() {
  dom.composerForm.addEventListener("submit", handleSend);
  dom.deleteChatBtn.addEventListener("click", deleteCurrentChat);
  dom.newChatBtn.addEventListener("click", startNewChat);
  dom.clearChatBtn.addEventListener("click", clearCurrentChat);


  dom.micBtn.addEventListener("click", async () => {
  if (!speechEnabled || !recognition) {
    alert("Speech recognition is not supported.");
    return;
  }

  if (state.isGenerating) {
    return;
  }

  try {
    recognition.start();
  } catch (error) {
    console.error(error);
  }
});
  dom.modelSelect.addEventListener("change", () => {
    state.selectedModel = dom.modelSelect.value;
    state.modelReadyFor = "";
    persistState();
    dom.runtimeHint.textContent = "Jarvis will load this model on your next prompt.";
    setStatus("idle", "Model switched. Jarvis will reload on next use.");
  });

  dom.promptInput.addEventListener("input", autoResizeTextarea);
  dom.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  });

  dom.historyList.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-chat-id]");
    if (trigger) {
      switchConversation(trigger.dataset.chatId);
    }
  });

  document.querySelectorAll(".prompt-chip").forEach((button) => {
    button.addEventListener("click", () => {
      dom.promptInput.value = button.dataset.prompt || "";
      autoResizeTextarea();
      dom.promptInput.focus();
    });
  });

  window.addEventListener("pointermove", (event) => {
    const x = `${(event.clientX / window.innerWidth) * 100}%`;
    const y = `${(event.clientY / window.innerHeight) * 100}%`;
    document.documentElement.style.setProperty("--pointer-x", x);
    document.documentElement.style.setProperty("--pointer-y", y);
  });
}

function initBackground() {
  const canvas = document.querySelector("#backgroundCanvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const particles = [];
  const particleCount = Math.min(80, Math.max(36, Math.floor(window.innerWidth / 18)));

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * ratio);
    canvas.height = Math.floor(window.innerHeight * ratio);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function buildParticles() {
    particles.length = 0;
    for (let index = 0; index < particleCount; index += 1) {
      particles.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        vx: (Math.random() - 0.5) * 0.42,
        vy: (Math.random() - 0.5) * 0.42,
        radius: Math.random() * 1.8 + 0.8,
      });
    }
  }

  function tick() {
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const particle of particles) {
      const dx = pointer.x - particle.x;
      const dy = pointer.y - particle.y;
      const distance = Math.hypot(dx, dy) || 1;

      if (distance < 180) {
        particle.vx -= (dx / distance) * 0.004;
        particle.vy -= (dy / distance) * 0.004;
      }

      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.996;
      particle.vy *= 0.996;

      if (particle.x < -10) particle.x = window.innerWidth + 10;
      if (particle.x > window.innerWidth + 10) particle.x = -10;
      if (particle.y < -10) particle.y = window.innerHeight + 10;
      if (particle.y > window.innerHeight + 10) particle.y = -10;

      context.beginPath();
      context.fillStyle = "rgba(150, 239, 255, 0.7)";
      context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fill();
    }

    for (let i = 0; i < particles.length; i += 1) {
      for (let j = i + 1; j < particles.length; j += 1) {
        const a = particles[i];
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distance = Math.hypot(dx, dy);

        if (distance < 125) {
          context.beginPath();
          context.strokeStyle = `rgba(120, 200, 255, ${0.14 - distance / 1250})`;
          context.lineWidth = 1;
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.stroke();
        }
      }
    }

    requestAnimationFrame(tick);
  }

  resize();
  buildParticles();

  window.addEventListener("resize", () => {
    resize();
    buildParticles();
  });

  window.addEventListener("pointermove", (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });

  tick();
}

function initCompatibilityNotice() {
  if (window.location.protocol === "file:") {
    setBanner(
      "For best results, run this project through a small local server instead of opening the HTML file directly. Module workers and browser model loading are more reliable that way.",
    );
  }
}

function init() {
  loadState();
  syncModelSelect();
  bindEvents();
  renderHistory();
  renderMessages();
  autoResizeTextarea();
  initBackground();
  initCompatibilityNotice();
  
  initSpeechRecognition();
  if ("gpu" in navigator) {
    setStatus("idle", "WebGPU detected. Jarvis will load when you send a message.");
  } else {
    setStatus("error", "WebGPU not detected");
  }
}
window.downloadGeneratedImage = function(imageUrl) {
  try {
    const link = document.createElement("a");

    link.href = imageUrl;

    link.download = `jarvis-image-${Date.now()}.png`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    console.log("Image downloaded");
  } catch (error) {
    console.error("Download failed:", error);
  }
};
init();
