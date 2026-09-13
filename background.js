/**
 * Mesaj Süre Takip — Manifest V3 service worker.
 * Sohbet sekmesi arkadayken taramayı canlı tutar, rozeti günceller,
 * alarmı offscreen belgede çalar (Chrome gizli sekmede sesi keser).
 */

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  alarmThresholdSeconds: 120,
  volume: 1,
  mutedUntil: 0,
  soundMode: "builtin",
  settingsVersion: 2
});

const CHAT_TAB_URLS = [
  "https://*.lively-chat.com/*",
  "https://lively-chat.com/*"
];

/**
 * tabId -> (frameId -> snapshot)
 * @type {Map<number, Map<number, { maxWaitTimeSeconds: number, matchCount: number, alarmActive: boolean, updatedAt: number }>>}
 */
const tabFrames = new Map();

let offscreenPlaying = false;

function isValidThreshold(value) {
  return Number.isFinite(value) && value >= 5 && value <= 3600;
}

function isChatWatchUrl(href) {
  const blob = String(href || "").toLowerCase();
  if (/\/demo\/|badge-reset\.html/i.test(blob)) return true;
  if (/\/agentconsole\/agents\b|\/agentconsole\/report|\/agentconsole\/setting|\/agentconsole\/monitor/.test(blob)) {
    return false;
  }
  return /\/agentconsole\/chats\b/.test(blob);
}

async function ensureDefaults() {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const patch = {};

  if (typeof current.enabled !== "boolean") patch.enabled = DEFAULT_SETTINGS.enabled;
  if (!isValidThreshold(Number(current.alarmThresholdSeconds))) {
    patch.alarmThresholdSeconds = DEFAULT_SETTINGS.alarmThresholdSeconds;
  }
  if (Number(current.settingsVersion) !== 2) {
    patch.volume = DEFAULT_SETTINGS.volume;
    patch.soundMode = current.soundMode === "custom" || current.soundMode === "iphone1" || current.soundMode === "iphone2"
      ? current.soundMode
      : "builtin";
    patch.settingsVersion = 2;
  } else if (!Number.isFinite(Number(current.volume)) || current.volume < 0 || current.volume > 1) {
    patch.volume = DEFAULT_SETTINGS.volume;
  }
  if (
    current.soundMode !== "custom"
    && current.soundMode !== "builtin"
    && current.soundMode !== "iphone1"
    && current.soundMode !== "iphone2"
  ) {
    patch.soundMode = DEFAULT_SETTINGS.soundMode;
  }
  if (!Number.isFinite(Number(current.mutedUntil))) patch.mutedUntil = 0;

  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

function pruneStale(maxAgeMs = 120_000) {
  const now = Date.now();
  for (const [tabId, frames] of tabFrames) {
    for (const [frameId, state] of frames) {
      if (now - state.updatedAt > maxAgeMs) frames.delete(frameId);
    }
    if (frames.size === 0) tabFrames.delete(tabId);
  }
}

function aggregateFrames(frames) {
  let maxWaitTimeSeconds = 0;
  let matchCount = 0;
  let alarmActive = false;
  let lastSeenMs = 0;
  let alive = false;

  for (const state of frames.values()) {
    matchCount += state.matchCount;
    maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, state.maxWaitTimeSeconds);
    alarmActive = alarmActive || state.alarmActive;
    if (state.updatedAt > lastSeenMs) lastSeenMs = state.updatedAt;
    alive = alive || Boolean(state.alive);
  }

  return { maxWaitTimeSeconds, matchCount, alarmActive, watchedTabs: 1, lastSeenMs, alive };
}

function aggregateTab(tabId) {
  const frames = tabFrames.get(tabId);
  if (!frames || frames.size === 0) {
    return { maxWaitTimeSeconds: 0, matchCount: 0, alarmActive: false, watchedTabs: 0, lastSeenMs: 0, alive: false };
  }
  return aggregateFrames(frames);
}

function aggregateAll() {
  pruneStale();
  let maxWaitTimeSeconds = 0;
  let matchCount = 0;
  let alarmActive = false;
  let watchedTabs = 0;
  let lastSeenMs = 0;
  let alive = false;

  for (const frames of tabFrames.values()) {
    if (frames.size === 0) continue;
    watchedTabs += 1;
    const part = aggregateFrames(frames);
    matchCount += part.matchCount;
    maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, part.maxWaitTimeSeconds);
    alarmActive = alarmActive || part.alarmActive;
    lastSeenMs = Math.max(lastSeenMs, part.lastSeenMs || 0);
    alive = alive || Boolean(part.alive);
  }

  return { maxWaitTimeSeconds, matchCount, alarmActive, watchedTabs, lastSeenMs, alive };
}

function formatBadgeText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

async function refreshGlobalBadge() {
  const state = aggregateAll();
  try {
    await chrome.action.setBadgeText({ text: formatBadgeText(state.maxWaitTimeSeconds) });
    if (state.maxWaitTimeSeconds > 0) {
      await chrome.action.setBadgeBackgroundColor({
        color: state.alarmActive ? "#E11D48" : "#0F766E"
      });
      await chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
    }
  } catch {
    /* ignore */
  }
}

async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument) return false;
  try {
    const contexts = await chrome.runtime.getContexts?.({
      contextTypes: ["OFFSCREEN_DOCUMENT"]
    });
    if (contexts && contexts.length) return true;
  } catch {
    /* getContexts yok */
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Sohbet sekmesi arkadayken bekleme alarmını çalmak"
    });
    return true;
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    if (/already exists|only one offscreen/i.test(text)) return true;
    return false;
  }
}

async function loadAlarmConfig() {
  const stored = await chrome.storage.sync.get({
    volume: 1,
    soundMode: "builtin",
    mutedUntil: 0,
    enabled: true
  });
  let local = { customSoundDataUrl: "" };
  try {
    local = await chrome.storage.local.get({ customSoundDataUrl: "" });
  } catch {
    local = { customSoundDataUrl: "" };
  }
  return {
    volume: Number(stored.volume) || 0,
    soundMode: stored.soundMode === "custom" || stored.soundMode === "iphone1" || stored.soundMode === "iphone2"
      ? stored.soundMode
      : "builtin",
    customSoundDataUrl: local.customSoundDataUrl || "",
    mutedUntil: Number(stored.mutedUntil) || 0,
    enabled: stored.enabled !== false
  };
}

async function startOffscreenAlarm() {
  const config = await loadAlarmConfig();
  if (!config.enabled || Date.now() < config.mutedUntil) {
    await stopOffscreenAlarm();
    return;
  }
  const ok = await ensureOffscreen();
  if (!ok) return;
  offscreenPlaying = true;
  chrome.runtime.sendMessage({
    type: "OFFSCREEN_PLAY",
    config: {
      volume: config.volume,
      soundMode: config.soundMode,
      customSoundDataUrl: config.customSoundDataUrl
    }
  }).catch(() => {});
}

async function stopOffscreenAlarm() {
  if (!offscreenPlaying) return;
  offscreenPlaying = false;
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => {});
}

async function pingChatTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: CHAT_TAB_URLS });
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab?.id || !isChatWatchUrl(tab.url || "")) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "SCAN_NOW" });
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["alarm.js", "content.js"]
        });
      } catch {
        /* sekme kısıtlı */
      }
    }
  }
}

function ensureWatchAlarm() {
  if (!chrome.alarms?.create) return;
  chrome.alarms.create("wait-alarm-watch", { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch(() => {});
  ensureWatchAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaults().catch(() => {});
  ensureWatchAlarm();
});

ensureWatchAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === "wait-alarm-watch") {
    pingChatTabs().catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFrames.delete(tabId);
  refreshGlobalBadge().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabFrames.delete(tabId);
  }
  refreshGlobalBadge().catch(() => {});
});

chrome.storage.onChanged.addListener(() => {
  if (offscreenPlaying) startOffscreenAlarm().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "WAIT_SCAN_RESULT") {
    const tabId = sender.tab?.id;
    const href = message.href || sender.tab?.url || "";
    if (typeof tabId === "number" && !isChatWatchUrl(href)) {
      tabFrames.delete(tabId);
      refreshGlobalBadge().catch(() => {});
      stopOffscreenAlarm().catch(() => {});
      sendResponse({ ok: true });
      return true;
    }
    if (typeof tabId === "number") {
      const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
      if (!tabFrames.has(tabId)) tabFrames.set(tabId, new Map());
      tabFrames.get(tabId).set(frameId, {
        maxWaitTimeSeconds: Math.max(0, Number(message.maxWaitTimeSeconds) || 0),
        matchCount: Math.max(0, Number(message.matchCount) || 0),
        alarmActive: Boolean(message.alarmActive),
        alive: true,
        updatedAt: Date.now()
      });
      refreshGlobalBadge().catch(() => {});
      if (message.alarmActive) startOffscreenAlarm().catch(() => {});
      else stopOffscreenAlarm().catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "PLAY_ALARM") {
    startOffscreenAlarm().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "SILENCE_ALARM" || message.type === "STOP_ALARM") {
    stopOffscreenAlarm().catch(() => {});
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      chrome.tabs.sendMessage(tabId, { type: "SILENCE_ALARM" }).catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "GET_WATCH_STATUS") {
    pruneStale();
    sendResponse(aggregateAll());
    return true;
  }

  return undefined;
});
