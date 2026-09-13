(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true,
    alarmThresholdSeconds: 120,
    volume: 1,
    mutedUntil: 0,
    soundMode: "builtin"
  });
  const MAX_SOUND_BYTES = 2 * 1024 * 1024;

  const enabledEl = document.getElementById("enabled");
  const rangeEl = document.getElementById("thresholdRange");
  const inputEl = document.getElementById("thresholdInput");
  const thresholdLabel = document.getElementById("thresholdLabel");
  const volumeEl = document.getElementById("volume");
  const volumeLabel = document.getElementById("volumeLabel");
  const waitValueEl = document.getElementById("waitValue");
  const statusMetaEl = document.getElementById("statusMeta");
  const statePillEl = document.getElementById("statePill");
  const offConsoleEl = document.getElementById("offConsole");
  const testBtn = document.getElementById("testAlarm");
  const muteBtn = document.getElementById("muteFive");
  const pickSoundBtn = document.getElementById("pickSound");
  const clearSoundBtn = document.getElementById("clearSound");
  const soundFileEl = document.getElementById("soundFile");
  const soundModeLabel = document.getElementById("soundModeLabel");
  const soundFileName = document.getElementById("soundFileName");
  const soundError = document.getElementById("soundError");
  const presetButtons = [...document.querySelectorAll("[data-threshold]")];

  let statusTimer = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatSeconds(total) {
    const seconds = Math.max(0, Math.floor(Number(total) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function paintThreshold(seconds) {
    const value = clamp(Math.round(Number(seconds) || 120), 5, 3600);
    thresholdLabel.textContent = `${value} sn`;
    inputEl.value = String(value);
    rangeEl.value = String(clamp(value, Number(rangeEl.min), Number(rangeEl.max)));
    for (const btn of presetButtons) {
      btn.classList.toggle("active", Number(btn.dataset.threshold) === value);
    }
  }

  function paintVolume(volume) {
    const pct = Math.round(clamp(Number(volume) || 0, 0, 1) * 100);
    volumeEl.value = String(pct);
    volumeLabel.textContent = `${pct}%`;
  }

  function showSoundError(message) {
    if (!message) {
      soundError.style.display = "none";
      soundError.textContent = "";
      return;
    }
    soundError.style.display = "block";
    soundError.textContent = message;
  }

  function paintSound(mode, name) {
    const custom = mode === "custom" && name;
    soundModeLabel.textContent = custom ? "Kendi sesiniz" : "Dahili siren";
    soundFileName.textContent = custom
      ? name
      : "Varsayılan yüksek siren kullanılır.";
    clearSoundBtn.disabled = !custom;
  }

  async function save(patch) {
    await chrome.storage.sync.set(patch);
  }

  async function load() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    let local = { customSoundName: "", customSoundDataUrl: "" };
    try {
      local = await chrome.storage.local.get({
        customSoundName: "",
        customSoundDataUrl: ""
      });
    } catch {
      /* local storage yoksa dahili ses */
    }
    enabledEl.checked = stored.enabled !== false;
    paintThreshold(stored.alarmThresholdSeconds);
    paintVolume(stored.volume);
    paintSound(stored.soundMode, local.customSoundName);
    updateMuteLabel(Number(stored.mutedUntil) || 0);
    globalThis.WaitAlarmPlayer?.configure({
      volume: Number(stored.volume) || 1,
      soundMode: stored.soundMode === "custom" ? "custom" : "builtin",
      customSoundDataUrl: local.customSoundDataUrl || ""
    });
  }

  function updateMuteLabel(mutedUntil) {
    if (mutedUntil > Date.now()) {
      const left = Math.ceil((mutedUntil - Date.now()) / 1000);
      muteBtn.textContent = `Sessiz (${left}s)`;
    } else {
      muteBtn.textContent = "5 dk sessiz";
    }
  }

  function paintStatus(status, onChats) {
    const maxWait = Number(status?.maxWaitTimeSeconds) || 0;
    const matches = Number(status?.matchCount) || 0;
    const alarmActive = Boolean(status?.alarmActive);
    const watching = Boolean(status?.alive && Number(status?.watchedTabs) > 0);
    const lastSeen = Number(status?.lastSeenMs) || 0;
    const stale = !watching || !lastSeen || Date.now() - lastSeen > 90_000;

    if (!onChats && !watching) {
      waitValueEl.innerHTML = `0<span>sn</span>`;
      statePillEl.textContent = "Konsol yok";
      statePillEl.className = "pill idle";
      statusMetaEl.textContent = "Sohbet sekmesi açık değil. Chats ekranını açık bırakın; diğer sekmelerde de arkada izler.";
      offConsoleEl.classList.add("show");
      return;
    }

    waitValueEl.innerHTML = `${formatSeconds(maxWait)}<span>${maxWait >= 60 ? "dk:sn" : "sn"}</span>`;
    offConsoleEl.classList.remove("show");

    const behind = onChats ? "" : " · sohbet sekmesi arkada";
    if (stale) {
      statePillEl.textContent = "Bağlı değil";
      statePillEl.className = "pill idle";
      statusMetaEl.textContent = "Sohbet sekmesi yanıt vermiyor. Chats sekmesini açık tutun, eklentiyi Yenile’ye basın.";
      return;
    }
    if (alarmActive) {
      statePillEl.textContent = "Alarm";
      statePillEl.className = "pill alarm";
      statusMetaEl.textContent = `${matches} sol liste rozeti · eşik aşıldı${behind}`;
    } else if (maxWait > 0) {
      statePillEl.textContent = onChats ? "İzleniyor" : "Arkada";
      statePillEl.className = "pill";
      statusMetaEl.textContent = `${matches} sol liste rozeti izleniyor${behind}`;
    } else {
      statePillEl.textContent = onChats ? "Beklemede" : "Arkada";
      statePillEl.className = "pill idle";
      statusMetaEl.textContent = onChats
        ? "Sol listede yanıtsız rozet yok · sayaç 0"
        : "Sohbet sekmesi arkada izleniyor · sayaç 0";
    }
  }

  function isChatWatchUrl(href) {
    const blob = String(href || "").toLowerCase();
    if (/\/demo\/|badge-reset\.html/i.test(blob)) return true;
    if (/\/agentconsole\/agents\b|\/agentconsole\/report|\/agentconsole\/setting|\/agentconsole\/monitor/.test(blob)) {
      return false;
    }
    return /\/agentconsole\/chats\b/.test(blob);
  }

  async function refreshStatus() {
    let onChats = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      onChats = isChatWatchUrl(tab?.url || "");
    } catch {
      onChats = false;
    }

    try {
      const status = await chrome.runtime.sendMessage({
        type: "GET_WATCH_STATUS"
      });
      paintStatus(status, onChats);
    } catch {
      paintStatus(null, onChats);
    }

    const stored = await chrome.storage.sync.get(["mutedUntil"]);
    updateMuteLabel(Number(stored.mutedUntil) || 0);
  }

  function configurePlayerFromUi(extra = {}) {
    globalThis.WaitAlarmPlayer?.configure({
      volume: Number(volumeEl.value) / 100,
      ...extra
    });
  }

  enabledEl.addEventListener("change", () => {
    save({ enabled: enabledEl.checked });
  });

  rangeEl.addEventListener("input", () => {
    paintThreshold(rangeEl.value);
  });
  rangeEl.addEventListener("change", () => {
    save({ alarmThresholdSeconds: Number(rangeEl.value) });
  });

  inputEl.addEventListener("change", () => {
    const value = clamp(Math.round(Number(inputEl.value) || 120), 5, 3600);
    paintThreshold(value);
    save({ alarmThresholdSeconds: value });
  });

  for (const btn of presetButtons) {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.threshold);
      paintThreshold(value);
      save({ alarmThresholdSeconds: value });
    });
  }

  volumeEl.addEventListener("input", () => {
    paintVolume(Number(volumeEl.value) / 100);
    configurePlayerFromUi();
  });
  volumeEl.addEventListener("change", () => {
    save({ volume: Number(volumeEl.value) / 100 });
  });

  testBtn.addEventListener("click", () => {
    showSoundError("");
    configurePlayerFromUi();
    globalThis.WaitAlarmPlayer?.unlock();
    globalThis.WaitAlarmPlayer?.test(2800);
  });

  muteBtn.addEventListener("click", async () => {
    const stored = await chrome.storage.sync.get(["mutedUntil"]);
    const currentlyMuted = Number(stored.mutedUntil) > Date.now();
    await save({ mutedUntil: currentlyMuted ? 0 : Date.now() + 5 * 60 * 1000 });
    refreshStatus();
  });

  pickSoundBtn.addEventListener("click", () => soundFileEl.click());

  soundFileEl.addEventListener("change", async () => {
    const file = soundFileEl.files && soundFileEl.files[0];
    soundFileEl.value = "";
    if (!file) return;
    if (file.size > MAX_SOUND_BYTES) {
      showSoundError("Dosya 2 MB’dan küçük olmalı.");
      return;
    }
    if (file.type && !file.type.startsWith("audio/")) {
      showSoundError("Yalnızca ses dosyası seçin (MP3, WAV, OGG).");
      return;
    }
    showSoundError("");
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    await chrome.storage.local.set({
      customSoundDataUrl: dataUrl,
      customSoundName: file.name
    });
    await save({ soundMode: "custom" });
    paintSound("custom", file.name);
    configurePlayerFromUi({
      soundMode: "custom",
      customSoundDataUrl: dataUrl
    });
  });

  clearSoundBtn.addEventListener("click", async () => {
    showSoundError("");
    await chrome.storage.local.remove(["customSoundDataUrl", "customSoundName"]);
    await save({ soundMode: "builtin" });
    paintSound("builtin", "");
    configurePlayerFromUi({
      soundMode: "builtin",
      customSoundDataUrl: ""
    });
  });

  window.addEventListener("unload", () => {
    window.clearInterval(statusTimer);
    globalThis.WaitAlarmPlayer?.stop();
  });

  async function injectIntoActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      if (!isChatWatchUrl(tab.url || "")) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: false },
        files: ["content.js"]
      });
    } catch {
      /* host izni yoksa veya restricted sayfa */
    }
  }

  load()
    .then(async () => {
      await injectIntoActiveTab();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return refreshStatus();
    })
    .catch(() => {});
  statusTimer = window.setInterval(() => {
    refreshStatus().catch(() => {});
  }, 1000);
})();
