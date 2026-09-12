/**
 * Comm100 Bekleme Alarmı — Manifest V3 service worker.
 * Sekme ve frame bazlı tarama sonuçlarını birleştirir, rozeti günceller,
 * varsayılan ayarları yazar. DOM taraması ve ses üretimi content.js'tedir.
 */

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  alarmThresholdSeconds: 120,
  volume: 0.55,
  mutedUntil: 0
});

/**
 * tabId -> (frameId -> snapshot)
 * @type {Map<number, Map<number, { maxWaitTimeSeconds: number, matchCount: number, alarmActive: boolean, updatedAt: number }>>}
 */
const tabFrames = new Map();

function isValidThreshold(value) {
  return Number.isFinite(value) && value >= 5 && value <= 3600;
}

async function ensureDefaults() {
  const current = await chrome.storage.sync.get(Object.keys(DEFAULT_SETTINGS));
  const patch = {};

  if (typeof current.enabled !== "boolean") patch.enabled = DEFAULT_SETTINGS.enabled;
  if (!isValidThreshold(Number(current.alarmThresholdSeconds))) {
    patch.alarmThresholdSeconds = DEFAULT_SETTINGS.alarmThresholdSeconds;
  }
  if (!Number.isFinite(Number(current.volume)) || current.volume < 0 || current.volume > 1) {
    patch.volume = DEFAULT_SETTINGS.volume;
  }
  if (!Number.isFinite(Number(current.mutedUntil))) patch.mutedUntil = 0;

  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
}

function pruneStale(maxAgeMs = 30_000) {
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

  for (const state of frames.values()) {
    matchCount += state.matchCount;
    maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, state.maxWaitTimeSeconds);
    alarmActive = alarmActive || state.alarmActive;
  }

  return { maxWaitTimeSeconds, matchCount, alarmActive, watchedTabs: 1 };
}

function aggregateTab(tabId) {
  const frames = tabFrames.get(tabId);
  if (!frames || frames.size === 0) {
    return { maxWaitTimeSeconds: 0, matchCount: 0, alarmActive: false, watchedTabs: 0 };
  }
  return aggregateFrames(frames);
}

function aggregateAll() {
  pruneStale();
  let maxWaitTimeSeconds = 0;
  let matchCount = 0;
  let alarmActive = false;
  let watchedTabs = 0;

  for (const frames of tabFrames.values()) {
    if (frames.size === 0) continue;
    watchedTabs += 1;
    const part = aggregateFrames(frames);
    matchCount += part.matchCount;
    maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, part.maxWaitTimeSeconds);
    alarmActive = alarmActive || part.alarmActive;
  }

  return { maxWaitTimeSeconds, matchCount, alarmActive, watchedTabs };
}

function formatBadgeText(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

async function refreshBadge(tabId) {
  const state = aggregateTab(tabId);
  try {
    if (state.maxWaitTimeSeconds <= 0) {
      await chrome.action.setBadgeText({ tabId, text: "" });
      return;
    }

    await chrome.action.setBadgeText({
      tabId,
      text: formatBadgeText(state.maxWaitTimeSeconds)
    });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: state.alarmActive ? "#E11D48" : "#0F766E"
    });
    await chrome.action.setBadgeTextColor({ tabId, color: "#FFFFFF" });
  } catch {
    tabFrames.delete(tabId);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaults().catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabFrames.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabFrames.delete(tabId);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return;

  if (message.type === "WAIT_SCAN_RESULT") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      const frameId = typeof sender.frameId === "number" ? sender.frameId : 0;
      if (!tabFrames.has(tabId)) tabFrames.set(tabId, new Map());
      tabFrames.get(tabId).set(frameId, {
        maxWaitTimeSeconds: Math.max(0, Number(message.maxWaitTimeSeconds) || 0),
        matchCount: Math.max(0, Number(message.matchCount) || 0),
        alarmActive: Boolean(message.alarmActive),
        updatedAt: Date.now()
      });
      refreshBadge(tabId);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "GET_WATCH_STATUS") {
    sendResponse(aggregateAll());
    return true;
  }

  return undefined;
});
