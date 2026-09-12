(() => {
  "use strict";

  const DEFAULTS = Object.freeze({
    enabled: true,
    alarmThresholdSeconds: 120,
    volume: 0.55,
    mutedUntil: 0
  });

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
  const presetButtons = [...document.querySelectorAll("[data-threshold]")];

  let testCtx = null;
  let testTimer = 0;
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

  async function save(patch) {
    await chrome.storage.sync.set(patch);
  }

  async function load() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    enabledEl.checked = stored.enabled !== false;
    paintThreshold(stored.alarmThresholdSeconds);
    paintVolume(stored.volume);
    updateMuteLabel(Number(stored.mutedUntil) || 0);
  }

  function updateMuteLabel(mutedUntil) {
    if (mutedUntil > Date.now()) {
      const left = Math.ceil((mutedUntil - Date.now()) / 1000);
      muteBtn.textContent = `Sessiz (${left}s)`;
    } else {
      muteBtn.textContent = "5 dk sessiz";
    }
  }

  function paintStatus(status, onConsole) {
    const maxWait = Number(status?.maxWaitTimeSeconds) || 0;
    const matches = Number(status?.matchCount) || 0;
    const alarmActive = Boolean(status?.alarmActive);

    waitValueEl.innerHTML = `${formatSeconds(maxWait)}<span>${maxWait >= 60 ? "dk:sn" : "sn"}</span>`;
    if (!onConsole) {
      statePillEl.textContent = "Konsol yok";
      statePillEl.className = "pill idle";
      statusMetaEl.textContent = "Açık sekmede ajan konsolu algılanmadı";
      offConsoleEl.classList.add("show");
      return;
    }

    offConsoleEl.classList.remove("show");
    if (alarmActive) {
      statePillEl.textContent = "Alarm";
      statePillEl.className = "pill alarm";
      statusMetaEl.textContent = `${matches} aktif sayaç · eşik aşıldı`;
    } else if (maxWait > 0) {
      statePillEl.textContent = "İzleniyor";
      statePillEl.className = "pill";
      statusMetaEl.textContent = `${matches} aktif sayaç izleniyor`;
    } else {
      statePillEl.textContent = "Beklemede";
      statePillEl.className = "pill idle";
      statusMetaEl.textContent = "Yanıtsız bekleme sayacı yok";
    }
  }

  async function refreshStatus() {
    let onConsole = false;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || "";
      onConsole = /lively-chat\.com|comm100\.com|comm100app\.com/i.test(url);
    } catch {
      onConsole = false;
    }

    try {
      const status = await chrome.runtime.sendMessage({ type: "GET_WATCH_STATUS" });
      paintStatus(status, onConsole || Boolean(status?.watchedTabs));
    } catch {
      paintStatus(null, onConsole);
    }

    const stored = await chrome.storage.sync.get(["mutedUntil"]);
    updateMuteLabel(Number(stored.mutedUntil) || 0);
  }

  function playTestBeep(volume) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!testCtx || testCtx.state === "closed") testCtx = new Ctx();
    if (testCtx.state === "suspended") testCtx.resume().catch(() => {});

    const osc = testCtx.createOscillator();
    const gain = testCtx.createGain();
    const filter = testCtx.createBiquadFilter();
    osc.type = "square";
    osc.frequency.value = 880;
    filter.type = "bandpass";
    filter.frequency.value = 880;
    filter.Q.value = 8;
    const now = testCtx.currentTime;
    const level = clamp(volume, 0, 1) * 0.18;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(testCtx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
    osc.onended = () => {
      try { osc.disconnect(); } catch { /* ignore */ }
      try { filter.disconnect(); } catch { /* ignore */ }
      try { gain.disconnect(); } catch { /* ignore */ }
    };
  }

  function startTestAlarm() {
    const volume = Number(volumeEl.value) / 100;
    playTestBeep(volume);
    window.clearInterval(testTimer);
    let ticks = 1;
    testTimer = window.setInterval(() => {
      ticks += 1;
      playTestBeep(volume);
      if (ticks >= 4) {
        window.clearInterval(testTimer);
        testTimer = 0;
      }
    }, 800);
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
  });
  volumeEl.addEventListener("change", () => {
    save({ volume: Number(volumeEl.value) / 100 });
  });

  testBtn.addEventListener("click", startTestAlarm);

  muteBtn.addEventListener("click", async () => {
    const stored = await chrome.storage.sync.get(["mutedUntil"]);
    const currentlyMuted = Number(stored.mutedUntil) > Date.now();
    await save({ mutedUntil: currentlyMuted ? 0 : Date.now() + 5 * 60 * 1000 });
    refreshStatus();
  });

  window.addEventListener("unload", () => {
    window.clearInterval(testTimer);
    window.clearInterval(statusTimer);
    if (testCtx && testCtx.state !== "closed") testCtx.close().catch(() => {});
  });

  load()
    .then(() => refreshStatus())
    .catch(() => {});
  statusTimer = window.setInterval(() => {
    refreshStatus().catch(() => {});
  }, 1000);
})();
