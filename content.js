/**
 * Comm100 Bekleme Alarmı — content script
 *
 * Dinamik class/id'lere bağımlı olmadan metin nodlarını tarar, zaman
 * dizgelerini saniyeye çevirir ve eşik aşıldığında Web Audio API ile
 * kesikli alarm üretir. Bellek sızıntısı ve kopuk DOM düğümlerine karşı
 * korumalıdır: düğüm referansı tutulmaz, zamanlayıcılar tekildir, ses
 * düğümleri beep bitince disconnect edilir.
 */
(() => {
  "use strict";

  if (globalThis.__COMM100_WAIT_ALARM_LOADED__) return;
  globalThis.__COMM100_WAIT_ALARM_LOADED__ = true;

  const SCAN_INTERVAL_MS = 2000;
  const MUTATION_DEBOUNCE_MS = 250;
  const TRACK_TTL_SCANS = 4;
  const MAX_REASONABLE_SECONDS = 8 * 60 * 60;
  const ALARM_FREQUENCY_HZ = 880;
  const ALARM_GAP_MS = 800;
  const BEEP_DURATION_SEC = 0.22;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    alarmThresholdSeconds: 120,
    volume: 0.55,
    mutedUntil: 0
  });

  const POSITIVE_HINT =
    /\b(wait(?:ing)?|unanswered|pending|queue|queued|idle|unreplied|response\s*time|agent\s*idle|yan[ıi]t\s*bek|bekliyor|cevaplanmad[ıi]|kuyruk)\b/i;
  const NEGATIVE_HINT =
    /\b(duration|unresponsive|visitor\s*idle|local\s*time|timestamp|ended|closed|chat\s*time|s[uü]re\s*toplam|ziyaret[cç]i\s*idle)\b/i;
  const ATTR_POSITIVE = /wait|timer|elapsed|unanswered|queue|pending|idle|countdown/i;
  const ATTR_NEGATIVE = /duration|unresponsive|timestamp|clock|localtime|ended/i;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG", "MATH"]);

  /**
   * Uzun formattan kısaya: hh:mm:ss, mm:ss, Xm Ys, Xs.
   * Lookahead/lookbehind ile kelime içi sahte eşleşmeler elenir.
   */
  const TIME_REGEX =
    /(?:(?<!\d)(\d{1,2}):([0-5]\d):([0-5]\d)(?!\d))|(?:(?<!\d)(\d{1,3}):([0-5]\d)(?!\d))|(?:(?<!\d)(\d{1,4})\s*[mM]\s*(\d{1,2})\s*[sS](?![a-zA-Z]))|(?:(?<!\d)(\d{1,5})\s*[sS](?![a-zA-Z]))/g;

  const settings = {
    enabled: DEFAULT_SETTINGS.enabled,
    alarmThresholdSeconds: DEFAULT_SETTINGS.alarmThresholdSeconds,
    volume: DEFAULT_SETTINGS.volume,
    mutedUntil: DEFAULT_SETTINGS.mutedUntil
  };

  /** @type {Map<string, { seconds: number, lastSeenScan: number, liveHits: number }>} */
  const trackers = new Map();

  let scanToken = 0;
  let scanTimerId = 0;
  let mutationTimerId = 0;
  let observer = null;
  let storageListener = null;
  let visibilityHandler = null;
  let pageHideHandler = null;
  let pointerUnlockHandler = null;
  let destroyed = false;
  let lastMaxWait = 0;
  let lastAlarmActive = false;
  let lastMatchCount = 0;
  let scanning = false;

  const isExtensionContext = Boolean(
    typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id
  );

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Yakalanan zaman dizgesini toplam saniyeye çevirir.
   * @param {string} raw
   * @returns {number} parsedSeconds; geçersizse -1
   */
  function parseTimeToSeconds(raw) {
    if (!raw || typeof raw !== "string") return -1;
    const text = raw.trim();
    if (!text) return -1;

    let match = text.match(/^(?:(\d{1,2}):([0-5]\d):([0-5]\d))$/);
    if (match) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3]);
      if (hours > 23) return -1;
      return hours * 3600 + minutes * 60 + seconds;
    }

    match = text.match(/^(?:(\d{1,3}):([0-5]\d))$/);
    if (match) {
      return Number(match[1]) * 60 + Number(match[2]);
    }

    match = text.match(/^(?:(\d{1,4})\s*[mM]\s*(\d{1,2})\s*[sS])$/);
    if (match) {
      return Number(match[1]) * 60 + Number(match[2]);
    }

    match = text.match(/^(?:(\d{1,5})\s*[sS])$/);
    if (match) {
      return Number(match[1]);
    }

    return -1;
  }

  function normalizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const threshold = Number(source.alarmThresholdSeconds);
    const volume = Number(source.volume);
    const mutedUntil = Number(source.mutedUntil);

    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_SETTINGS.enabled,
      alarmThresholdSeconds: Number.isFinite(threshold)
        ? clamp(Math.round(threshold), 5, 3600)
        : DEFAULT_SETTINGS.alarmThresholdSeconds,
      volume: Number.isFinite(volume) ? clamp(volume, 0, 1) : DEFAULT_SETTINGS.volume,
      mutedUntil: Number.isFinite(mutedUntil) ? mutedUntil : 0
    };
  }

  function applySettings(next) {
    const normalized = normalizeSettings(next);
    settings.enabled = normalized.enabled;
    settings.alarmThresholdSeconds = normalized.alarmThresholdSeconds;
    settings.volume = normalized.volume;
    settings.mutedUntil = normalized.mutedUntil;
    if (!settings.enabled || Date.now() < settings.mutedUntil) alarmSynth.stop();
  }

  function isMuted() {
    return Date.now() < settings.mutedUntil;
  }

  function safeText(value) {
    return typeof value === "string" ? value : "";
  }

  function elementPathKey(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === Node.ELEMENT_NODE && depth < 8) {
      const tag = node.tagName || "EL";
      const classPart = typeof node.className === "string"
        ? node.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
      const siblingIndex = node.parentElement
        ? Array.prototype.indexOf.call(node.parentElement.children, node)
        : 0;
      parts.push(`${tag}${classPart ? "." + classPart : ""}[${siblingIndex}]`);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(">");
  }

  function nearbyContext(el) {
    if (!el) return "";
    const chunks = [
      safeText(el.textContent).slice(0, 180),
      safeText(el.getAttribute && el.getAttribute("aria-label")),
      safeText(el.getAttribute && el.getAttribute("title")),
      safeText(el.id),
      safeText(typeof el.className === "string" ? el.className : "")
    ];
    const parent = el.parentElement;
    if (parent) {
      chunks.push(safeText(parent.getAttribute("aria-label")));
      chunks.push(safeText(parent.getAttribute("title")));
      chunks.push(safeText(parent.id));
      chunks.push(safeText(typeof parent.className === "string" ? parent.className : ""));
    }
    const grand = parent && parent.parentElement;
    if (grand) {
      chunks.push(safeText(grand.getAttribute("aria-label")));
      chunks.push(safeText(grand.id));
      chunks.push(safeText(typeof grand.className === "string" ? grand.className : ""));
    }
    return chunks.filter(Boolean).join(" ");
  }

  function scoreMatch(el, parsedSeconds) {
    let score = 1;
    const ctx = nearbyContext(el);
    const attrBlob = ctx;

    if (POSITIVE_HINT.test(ctx)) score += 3;
    if (NEGATIVE_HINT.test(ctx)) score -= 4;
    if (ATTR_POSITIVE.test(attrBlob)) score += 2;
    if (ATTR_NEGATIVE.test(attrBlob)) score -= 3;
    if (parsedSeconds >= 1 && parsedSeconds <= settings.alarmThresholdSeconds * 12) score += 1;
    if (parsedSeconds > 3 * 60 * 60) score -= 2;
    return score;
  }

  function collectRootList(doc) {
    const roots = [doc];
    try {
      const all = doc.querySelectorAll("*");
      const limit = Math.min(all.length, 2500);
      for (let i = 0; i < limit; i += 1) {
        const el = all[i];
        if (el.shadowRoot) roots.push(el.shadowRoot);
      }
    } catch {
      // Kapalı shadow veya kopuk belge.
    }
    return roots;
  }

  function isSkippable(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return true;
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.closest && el.closest("script,style,noscript,textarea,input,select,[contenteditable='true']")) {
      return true;
    }
    try {
      const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
      if (style && (style.display === "none" || style.visibility === "hidden")) return true;
    } catch {
      return false;
    }
    return false;
  }

  function extractTimesFromText(text) {
    const found = [];
    TIME_REGEX.lastIndex = 0;
    let match;
    while ((match = TIME_REGEX.exec(text)) !== null) {
      let raw;
      if (match[1] !== undefined) raw = `${match[1]}:${match[2]}:${match[3]}`;
      else if (match[4] !== undefined) raw = `${match[4]}:${match[5]}`;
      else if (match[6] !== undefined) raw = `${match[6]}m ${match[7]}s`;
      else raw = `${match[8]}s`;

      const parsedSeconds = parseTimeToSeconds(raw);
      if (parsedSeconds >= 0 && parsedSeconds <= MAX_REASONABLE_SECONDS) {
        found.push({ raw, parsedSeconds, index: match.index });
      }
      if (TIME_REGEX.lastIndex === match.index) TIME_REGEX.lastIndex += 1;
    }
    return found;
  }

  function scanTextNodes(root, bucket) {
    let walker;
    try {
      walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (isSkippable(node)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      });
    } catch {
      return;
    }

    let hops = 0;
    let current = walker.nextNode();
    while (current && hops < 4000) {
      hops += 1;
      const text = current.nodeValue;
      const hits = extractTimesFromText(text);
      if (hits.length) {
        const el = current.parentElement;
        for (const hit of hits) {
          const score = scoreMatch(el, hit.parsedSeconds);
          if (score <= 0) continue;
          bucket.push({
            key: `${elementPathKey(el)}::${hit.raw}`,
            parsedSeconds: hit.parsedSeconds,
            score,
            raw: hit.raw
          });
        }
      }
      current = walker.nextNode();
    }
  }

  function scanAttributeTimes(root, bucket) {
    let nodes;
    try {
      nodes = root.querySelectorAll
        ? root.querySelectorAll("[aria-label],[title],[data-wait],[data-time],[data-duration]")
        : [];
    } catch {
      return;
    }

    for (let i = 0; i < nodes.length && i < 800; i += 1) {
      const el = nodes[i];
      if (isSkippable(el)) continue;
      const blobs = [
        el.getAttribute("aria-label"),
        el.getAttribute("title"),
        el.getAttribute("data-wait"),
        el.getAttribute("data-time"),
        el.getAttribute("data-duration")
      ];
      for (const blob of blobs) {
        if (!blob) continue;
        const hits = extractTimesFromText(blob);
        for (const hit of hits) {
          const score = scoreMatch(el, hit.parsedSeconds);
          if (score <= 0) continue;
          bucket.push({
            key: `${elementPathKey(el)}@attr::${hit.raw}`,
            parsedSeconds: hit.parsedSeconds,
            score,
            raw: hit.raw
          });
        }
      }
    }
  }

  async function readComm100ApiWaits() {
    const api = globalThis.Comm100AgentConsoleAPI;
    if (!api || typeof api.get !== "function") return [];

    try {
      const result = await Promise.race([
        api.get("agentconsole.currentChat"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 400))
      ]);
      const chat = result && result.data;
      if (!chat) return [];
      if (String(chat.status || "").toLowerCase().includes("end")) return [];

      const waits = [];
      const status = String(chat.status || "").toLowerCase();
      if (status.includes("wait") && Number.isFinite(Number(chat.waitingTime))) {
        waits.push(Number(chat.waitingTime));
      }

      if (Array.isArray(chat.messages) && chat.messages.length) {
        let lastVisitor = 0;
        let lastAgent = 0;
        for (const message of chat.messages) {
          const stamp = Number(message.time) || 0;
          if (message.senderType === "visitor") lastVisitor = Math.max(lastVisitor, stamp);
          if (message.senderType === "agent") lastAgent = Math.max(lastAgent, stamp);
        }
        if (lastVisitor && lastVisitor >= lastAgent) {
          const nowUnix = Date.now() / 1000;
          const elapsed = Math.floor(nowUnix - lastVisitor);
          if (elapsed >= 0 && elapsed <= MAX_REASONABLE_SECONDS) waits.push(elapsed);
        }
      }

      return waits.filter((n) => n >= 0 && n <= MAX_REASONABLE_SECONDS);
    } catch {
      return [];
    }
  }

  function updateTrackers(matches) {
    scanToken += 1;
    let maxWaitTimeSeconds = 0;
    let matchCount = 0;

    for (const match of matches) {
      const prev = trackers.get(match.key);
      let liveHits = prev ? prev.liveHits : 0;
      if (prev) {
        const delta = match.parsedSeconds - prev.seconds;
        if (delta >= 1 && delta <= 6) liveHits += 1;
        else if (delta < -5) liveHits = 0;
      }

      trackers.set(match.key, {
        seconds: match.parsedSeconds,
        lastSeenScan: scanToken,
        liveHits
      });

      const liveBoost = liveHits >= 1 ? 2 : 0;
      const effectiveScore = match.score + liveBoost;
      if (effectiveScore <= 0) continue;

      matchCount += 1;
      maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, match.parsedSeconds);
    }

    for (const [key, tracker] of trackers) {
      if (scanToken - tracker.lastSeenScan >= TRACK_TTL_SCANS) trackers.delete(key);
    }

    return { maxWaitTimeSeconds, matchCount };
  }

  const alarmSynth = {
    ctx: null,
    loopId: 0,
    playing: false,
    unlockBound: false,

    ensureContext() {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null;
      if (!this.ctx || this.ctx.state === "closed") {
        try {
          this.ctx = new Ctx();
        } catch {
          this.ctx = null;
        }
      }
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    },

    beep() {
      const ctx = this.ensureContext();
      if (!ctx) return;
      let osc;
      let gain;
      let filter;
      try {
        osc = ctx.createOscillator();
        gain = ctx.createGain();
        filter = ctx.createBiquadFilter();
        osc.type = "square";
        osc.frequency.setValueAtTime(ALARM_FREQUENCY_HZ, ctx.currentTime);
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(ALARM_FREQUENCY_HZ, ctx.currentTime);
        filter.Q.setValueAtTime(8, ctx.currentTime);

        const level = clamp(settings.volume, 0, 1) * 0.18;
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + BEEP_DURATION_SEC);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + BEEP_DURATION_SEC + 0.02);
        osc.onended = () => {
          try { osc.disconnect(); } catch { /* already disconnected */ }
          try { filter.disconnect(); } catch { /* already disconnected */ }
          try { gain.disconnect(); } catch { /* already disconnected */ }
        };
      } catch {
        try { if (osc) osc.disconnect(); } catch { /* ignore */ }
        try { if (filter) filter.disconnect(); } catch { /* ignore */ }
        try { if (gain) gain.disconnect(); } catch { /* ignore */ }
      }
    },

    start() {
      if (this.playing) return;
      this.playing = true;
      this.beep();
      this.loopId = globalThis.setInterval(() => {
        if (!this.playing) return;
        this.beep();
      }, ALARM_GAP_MS);
    },

    stop() {
      if (!this.playing && !this.loopId) return;
      this.playing = false;
      if (this.loopId) {
        globalThis.clearInterval(this.loopId);
        this.loopId = 0;
      }
    },

    dispose() {
      this.stop();
      if (this.ctx && this.ctx.state !== "closed") {
        this.ctx.close().catch(() => {});
      }
      this.ctx = null;
    }
  };

  function shouldRing(maxWaitTimeSeconds) {
    return (
      settings.enabled &&
      !isMuted() &&
      maxWaitTimeSeconds > settings.alarmThresholdSeconds
    );
  }

  function publishStatus(maxWaitTimeSeconds, matchCount, alarmActive) {
    lastMaxWait = maxWaitTimeSeconds;
    lastMatchCount = matchCount;
    lastAlarmActive = alarmActive;

    if (!isExtensionContext) return;
    try {
      chrome.runtime.sendMessage(
        {
          type: "WAIT_SCAN_RESULT",
          maxWaitTimeSeconds,
          matchCount,
          alarmActive,
          threshold: settings.alarmThresholdSeconds
        },
        () => void chrome.runtime.lastError
      );
    } catch {
      // Extension context invalidated (yenileme / kaldırılma).
      teardown();
    }
  }

  async function scanOnce() {
    if (destroyed || scanning) return;
    scanning = true;
    try {
      const matches = [];
      const doc = document;
      if (!doc || !doc.documentElement) return;

      const roots = collectRootList(doc);
      for (const root of roots) {
        scanTextNodes(root, matches);
        scanAttributeTimes(root, matches);
      }

      const apiWaits = await readComm100ApiWaits();
      for (const seconds of apiWaits) {
        matches.push({
          key: `comm100-api:${seconds}`,
          parsedSeconds: seconds,
          score: 6,
          raw: `${seconds}s`
        });
      }

      const { maxWaitTimeSeconds, matchCount } = updateTrackers(matches);
      const alarmActive = shouldRing(maxWaitTimeSeconds);

      if (alarmActive) alarmSynth.start();
      else alarmSynth.stop();

      if (
        maxWaitTimeSeconds !== lastMaxWait ||
        matchCount !== lastMatchCount ||
        alarmActive !== lastAlarmActive
      ) {
        publishStatus(maxWaitTimeSeconds, matchCount, alarmActive);
      }
    } finally {
      scanning = false;
    }
  }

  function scheduleScan() {
    if (destroyed) return;
    if (mutationTimerId) return;
    mutationTimerId = globalThis.setTimeout(() => {
      mutationTimerId = 0;
      scanOnce().catch(() => {});
    }, MUTATION_DEBOUNCE_MS);
  }

  function attachObserver() {
    if (observer || !document.documentElement) return;
    try {
      observer = new MutationObserver(() => scheduleScan());
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        characterData: true
      });
    } catch {
      observer = null;
    }
  }

  function bindAudioUnlock() {
    if (alarmSynth.unlockBound) return;
    alarmSynth.unlockBound = true;
    pointerUnlockHandler = () => alarmSynth.ensureContext();
    document.addEventListener("pointerdown", pointerUnlockHandler, { passive: true });
    document.addEventListener("keydown", pointerUnlockHandler, { passive: true });
  }

  async function loadSettings() {
    if (!isExtensionContext || !chrome.storage?.sync) {
      applySettings(DEFAULT_SETTINGS);
      return;
    }
    try {
      const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      applySettings(stored);
    } catch {
      applySettings(DEFAULT_SETTINGS);
    }
  }

  function listenStorage() {
    if (!isExtensionContext || !chrome.storage?.onChanged) return;
    storageListener = (changes, area) => {
      if (area !== "sync") return;
      const next = { ...settings };
      if (changes.enabled) next.enabled = changes.enabled.newValue;
      if (changes.alarmThresholdSeconds) next.alarmThresholdSeconds = changes.alarmThresholdSeconds.newValue;
      if (changes.volume) next.volume = changes.volume.newValue;
      if (changes.mutedUntil) next.mutedUntil = changes.mutedUntil.newValue;
      applySettings(next);
      scanOnce().catch(() => {});
    };
    chrome.storage.onChanged.addListener(storageListener);
  }

  function teardown() {
    if (destroyed) return;
    destroyed = true;
    if (scanTimerId) globalThis.clearInterval(scanTimerId);
    if (mutationTimerId) globalThis.clearTimeout(mutationTimerId);
    scanTimerId = 0;
    mutationTimerId = 0;
    if (observer) {
      try { observer.disconnect(); } catch { /* ignore */ }
      observer = null;
    }
    trackers.clear();
    alarmSynth.dispose();
    if (storageListener && chrome?.storage?.onChanged) {
      try { chrome.storage.onChanged.removeListener(storageListener); } catch { /* ignore */ }
    }
    if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
    if (pageHideHandler) window.removeEventListener("pagehide", pageHideHandler);
    if (pointerUnlockHandler) {
      document.removeEventListener("pointerdown", pointerUnlockHandler);
      document.removeEventListener("keydown", pointerUnlockHandler);
    }
    globalThis.__COMM100_WAIT_ALARM_LOADED__ = false;
  }

  async function start() {
    await loadSettings();
    listenStorage();
    bindAudioUnlock();
    attachObserver();
    await scanOnce();
    scanTimerId = globalThis.setInterval(() => {
      scanOnce().catch(() => {});
    }, SCAN_INTERVAL_MS);

    visibilityHandler = () => {
      if (document.visibilityState === "visible") scanOnce().catch(() => {});
    };
    document.addEventListener("visibilitychange", visibilityHandler);

    pageHideHandler = () => teardown();
    window.addEventListener("pagehide", pageHideHandler, { once: true });
  }

  globalThis.Comm100WaitAlarm = {
    parseTimeToSeconds,
    extractTimesFromText,
    getStatus() {
      return {
        maxWaitTimeSeconds: lastMaxWait,
        matchCount: lastMatchCount,
        alarmActive: lastAlarmActive,
        threshold: settings.alarmThresholdSeconds,
        enabled: settings.enabled
      };
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => start().catch(() => {}), { once: true });
  } else {
    start().catch(() => {});
  }
})();
