/**
 * Comm100 Bekleme Alarmı — content script
 *
 * Dinamik class/id'lere bağımlı olmadan metin nodlarını tarar, zaman
 * Dizgelerini saniyeye çevirir; eşik aşılınca yüksek siren (veya
 * kullanıcının ses dosyası) çalar. Bellek sızıntısı ve kopuk DOM
 * düğümlerine karşı korumalıdır.
 */
(() => {
  "use strict";

  if (globalThis.__COMM100_WAIT_ALARM_LOADED__) return;
  globalThis.__COMM100_WAIT_ALARM_LOADED__ = true;

  const SCAN_INTERVAL_MS = 2000;
  const MUTATION_DEBOUNCE_MS = 250;
  const TRACK_TTL_SCANS = 4;
  const MAX_REASONABLE_SECONDS = 8 * 60 * 60;

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    alarmThresholdSeconds: 120,
    volume: 1,
    mutedUntil: 0,
    soundMode: "builtin"
  });

  const POSITIVE_HINT =
    /\b(wait(?:ing)?|unanswered|pending|queue|queued|idle|unreplied|response\s*time|agent\s*idle|yan[ıi]t\s*bek|bekliyor|cevaplanmad[ıi]|kuyruk|ongoing|unread)\b/i;
  const CHAT_LIST_HINT =
    /\b(ongoing|chats|inbox|conversation|canl[ıi]|unread|queue|waiting)\b/i;
  const NEGATIVE_HINT =
    /\b(unresponsive|visitor\s*idle|local\s*time|timestamp|ended|closed|local time|temsilci\s*yazd|yan[ıi]t\s*verdi)\b/i;
  const ATTR_POSITIVE = /wait|timer|elapsed|unanswered|queue|pending|idle|countdown/i;
  const ATTR_NEGATIVE = /duration|unresponsive|timestamp|clock|localtime|ended/i;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "CODE", "PRE", "SVG", "MATH"]);

  /**
   * Uzun formattan kısaya: hh:mm:ss, mm:ss, Xm Ys, Xm / Xdk, Xs.
   */
  const TIME_REGEX =
    /(?:(?<!\d)(\d{1,2}):([0-5]\d):([0-5]\d)(?!\d))|(?:(?<!\d)(\d{1,3}):([0-5]\d)(?!\d))|(?:(?<!\d)(\d{1,4})m(\d{1,2})s(?![a-zA-Z]))|(?:(?<!\d)(\d{1,4})m(?![a-zA-Z]))|(?:(?<!\d)(\d{1,5})s(?![a-zA-Z]))/g;

  const settings = {
    enabled: DEFAULT_SETTINGS.enabled,
    alarmThresholdSeconds: DEFAULT_SETTINGS.alarmThresholdSeconds,
    volume: DEFAULT_SETTINGS.volume,
    mutedUntil: DEFAULT_SETTINGS.mutedUntil,
    soundMode: DEFAULT_SETTINGS.soundMode,
    customSoundDataUrl: ""
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
  let scanQueued = false;
  let replyQuietUntil = 0;
  let runtimeListener = null;
  let replyKeyHandler = null;
  let replyClickHandler = null;

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

    match = text.match(/^(?:(\d{1,4})m(\d{1,2})s)$/i);
    if (match) {
      return Number(match[1]) * 60 + Number(match[2]);
    }

    match = text.match(/^(?:(\d{1,4})m)$/i);
    if (match) {
      return Number(match[1]) * 60;
    }

    match = text.match(/^(?:(\d{1,5})s)$/i);
    if (match) {
      return Number(match[1]);
    }

    match = text.match(/^(?:(\d{1,4})\s*[mM]\s*(\d{1,2})\s*[sS])$/);
    if (match) {
      return Number(match[1]) * 60 + Number(match[2]);
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
      mutedUntil: Number.isFinite(mutedUntil) ? mutedUntil : 0,
      soundMode: source.soundMode === "custom" ? "custom" : "builtin",
      customSoundDataUrl: typeof source.customSoundDataUrl === "string" ? source.customSoundDataUrl : ""
    };
  }

  function applySettings(next) {
    const normalized = normalizeSettings(next);
    settings.enabled = normalized.enabled;
    settings.alarmThresholdSeconds = normalized.alarmThresholdSeconds;
    settings.volume = normalized.volume;
    settings.mutedUntil = normalized.mutedUntil;
    settings.soundMode = normalized.soundMode;
    settings.customSoundDataUrl = normalized.customSoundDataUrl;
    if (globalThis.Comm100AlarmPlayer) {
      globalThis.Comm100AlarmPlayer.configure({
        volume: settings.volume,
        soundMode: settings.soundMode,
        customSoundDataUrl: settings.customSoundDataUrl
      });
    }
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
    const chunks = [];
    let node = el;
    let depth = 0;
    if (el) chunks.push(safeText(el.textContent).slice(0, 80));
    while (node && node.nodeType === Node.ELEMENT_NODE && depth < 6) {
      chunks.push(safeText(node.getAttribute && node.getAttribute("aria-label")));
      chunks.push(safeText(node.getAttribute && node.getAttribute("title")));
      chunks.push(safeText(node.id));
      chunks.push(safeText(typeof node.className === "string" ? node.className : ""));
      if (depth <= 2) chunks.push(safeText(node.textContent).slice(0, 220));
      node = node.parentElement;
      depth += 1;
    }
    return chunks.filter(Boolean).join(" ");
  }

  function isCompactBadge(raw) {
    return /^\d{1,4}m(?:\d{1,2}s)?$|^\d{1,5}s$/i.test(String(raw || "").trim());
  }

  function isDurationToken(raw) {
    return isCompactBadge(raw);
  }

  function scoreMatch(el, parsedSeconds, raw) {
    let score = 1;
    const ctx = nearbyContext(el);
    const attrBlob = ctx;
    const durationToken = isCompactBadge(raw);
    const listHint = CHAT_LIST_HINT.test(ctx);
    const waitHint = POSITIVE_HINT.test(ctx);
    const infoDuration = /\bmin(?:ute)?s?\b|\bvisits\b|\bsession\b|\bcustom field\b/i.test(ctx);
    let isWait = durationToken || ((waitHint || listHint) && !infoDuration);

    if (/^\d{1,2}:[0-5]\d$/.test(String(raw || ""))) isWait = false;
    if (infoDuration && !durationToken) isWait = false;

    if (isWait) score += 3;
    if (NEGATIVE_HINT.test(ctx)) score -= 2;
    if (ATTR_NEGATIVE.test(attrBlob) && !durationToken) score -= 3;
    if (parsedSeconds >= 1 && parsedSeconds <= settings.alarmThresholdSeconds * 12) score += 1;
    if (parsedSeconds > 3 * 60 * 60) score -= 2;
    return { score, isWait };
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
      let kind = "clock";
      if (match[1] !== undefined) raw = `${match[1]}:${match[2]}:${match[3]}`;
      else if (match[4] !== undefined) raw = `${match[4]}:${match[5]}`;
      else if (match[6] !== undefined) {
        raw = `${match[6]}m${match[7]}s`;
        kind = "duration";
      } else if (match[8] !== undefined) {
        raw = `${match[8]}m`;
        kind = "duration";
      } else {
        raw = `${match[9]}s`;
        kind = "duration";
      }

      const parsedSeconds = parseTimeToSeconds(raw);
      if (parsedSeconds >= 0 && parsedSeconds <= MAX_REASONABLE_SECONDS) {
        found.push({ raw, parsedSeconds, index: match.index, kind });
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
          const ranked = scoreMatch(el, hit.parsedSeconds, hit.raw);
          if (ranked.score <= 0 || !ranked.isWait) continue;
          bucket.push({
            key: `${elementPathKey(el)}#${hit.index}`,
            parsedSeconds: hit.parsedSeconds,
            score: ranked.score,
            isWait: true,
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
          if (!isCompactBadge(hit.raw)) continue;
          if (isIgnoredDurationContext(el)) continue;
          const ranked = scoreMatch(el, hit.parsedSeconds, hit.raw);
          if (ranked.score <= 0 || !ranked.isWait) continue;
          bucket.push({
            key: `${elementPathKey(el)}@attr#${hit.index}`,
            parsedSeconds: hit.parsedSeconds,
            score: ranked.score,
            isWait: true,
            raw: hit.raw
          });
        }
      }
    }
  }

  function nearbySnippet(el) {
    if (!el) return "";
    const chunks = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === Node.ELEMENT_NODE && depth < 4) {
      chunks.push(safeText(node.getAttribute && node.getAttribute("aria-label")));
      chunks.push(safeText(node.getAttribute && node.getAttribute("title")));
      if (depth <= 2) {
        chunks.push(safeText(node.innerText || node.textContent).slice(0, 160));
      }
      node = node.parentElement;
      depth += 1;
    }
    return chunks.filter(Boolean).join(" ");
  }

  /**
   * Sağdaki Info oturum süresi ("53 min 43 s") ve benzeri paneller
   * sol listedeki 12s/2m rozeti değildir.
   */
  function isIgnoredDurationContext(el) {
    const snippet = nearbySnippet(el);
    if (/\b\d+\s+min(?:ute)?s?\b/i.test(snippet)) return true;
    if (/\b(custom field|custom variable|referred from|campaign)\b/i.test(snippet)) return true;
    return false;
  }

  function compactLabelOf(el) {
    if (!el) return "";
    let own = "";
    const children = el.childNodes;
    if (children) {
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (child.nodeType === Node.TEXT_NODE) own += child.nodeValue || "";
      }
    }
    own = own.trim();
    if (isCompactBadge(own)) return own;
    if (el.children && el.children.length === 0) {
      const leaf = String(el.innerText || el.textContent || "").trim();
      if (isCompactBadge(leaf)) return leaf;
    }
    return "";
  }

  function scanIsolatedCompactBadges(root, bucket) {
    let nodes;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    } catch {
      return;
    }
    const limit = Math.min(nodes.length, 4000);
    for (let i = 0; i < limit; i += 1) {
      const el = nodes[i];
      if (isSkippable(el)) continue;
      const raw = compactLabelOf(el);
      if (!raw) continue;
      if (isIgnoredDurationContext(el)) continue;
      const parsedSeconds = parseTimeToSeconds(raw);
      if (parsedSeconds <= 0 || parsedSeconds > MAX_REASONABLE_SECONDS) continue;
      bucket.push({
        key: `${elementPathKey(el)}#badge`,
        parsedSeconds,
        score: 8,
        isWait: true,
        raw
      });
    }
  }

  function scanPseudoAndAttrs(root, bucket) {
    let nodes;
    try {
      nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
    } catch {
      return;
    }
    const limit = Math.min(nodes.length, 2000);
    for (let i = 0; i < limit; i += 1) {
      const el = nodes[i];
      if (isSkippable(el)) continue;
      const blobs = [];
      try {
        blobs.push(el.ownerDocument.defaultView.getComputedStyle(el, "::before").content);
        blobs.push(el.ownerDocument.defaultView.getComputedStyle(el, "::after").content);
      } catch {
        /* ignore */
      }
      if (el.attributes) {
        for (let a = 0; a < el.attributes.length && a < 20; a += 1) {
          blobs.push(el.attributes[a].value);
        }
      }
      for (const blob of blobs) {
        if (!blob || blob === "none" || blob === "normal") continue;
        const cleaned = String(blob).replace(/^["']|["']$/g, "");
        const hits = extractTimesFromText(cleaned);
        for (const hit of hits) {
          if (!isCompactBadge(hit.raw)) continue;
          if (isIgnoredDurationContext(el)) continue;
          bucket.push({
            key: `${elementPathKey(el)}::pseudo#${hit.index}`,
            parsedSeconds: hit.parsedSeconds,
            score: 5,
            isWait: true,
            raw: hit.raw
          });
        }
      }
    }
  }

  function dedupeWaitMatches(matches) {
    const byKey = new Map();
    for (const match of matches) {
      if (!match || !match.isWait || !isCompactBadge(match.raw)) continue;
      if (match.parsedSeconds <= 0) continue;
      const key = String(match.key || "")
        .replace(/#badge$/, "")
        .replace(/@attr#.*$/, "")
        .replace(/::pseudo#.*$/, "")
        .replace(/#.*$/, "") || match.key;
      const prev = byKey.get(key);
      if (!prev || match.parsedSeconds > prev.parsedSeconds) byKey.set(key, match);
    }
    return [...byKey.values()];
  }

  function updateTrackers(matches) {
    scanToken += 1;
    let maxWaitTimeSeconds = 0;
    let matchCount = 0;
    let sawReset = false;

    for (const match of matches) {
      if (!match.isWait || match.parsedSeconds <= 0) continue;

      const prev = trackers.get(match.key);
      let liveHits = prev ? prev.liveHits : 0;
      if (prev) {
        const delta = match.parsedSeconds - prev.seconds;
        if (delta < -3) {
          liveHits = 0;
          sawReset = true;
          trackers.set(match.key, {
            seconds: match.parsedSeconds,
            lastSeenScan: scanToken,
            liveHits: 0
          });
          continue;
        }
        if (delta >= 1 && delta <= 6) liveHits += 1;
      }

      trackers.set(match.key, {
        seconds: match.parsedSeconds,
        lastSeenScan: scanToken,
        liveHits
      });

      matchCount += 1;
      maxWaitTimeSeconds = Math.max(maxWaitTimeSeconds, match.parsedSeconds);
    }

    for (const [key, tracker] of trackers) {
      if (scanToken - tracker.lastSeenScan >= TRACK_TTL_SCANS) trackers.delete(key);
    }

    return { maxWaitTimeSeconds, matchCount, sawReset };
  }

  const alarmSynth = {
    start() {
      globalThis.Comm100AlarmPlayer?.start();
    },
    stop() {
      globalThis.Comm100AlarmPlayer?.stop();
    },
    dispose() {
      globalThis.Comm100AlarmPlayer?.dispose();
    }
  };

  function shouldRing(maxWaitTimeSeconds) {
    if (Date.now() < replyQuietUntil) return false;
    return (
      settings.enabled &&
      !isMuted() &&
      maxWaitTimeSeconds > 0 &&
      maxWaitTimeSeconds >= settings.alarmThresholdSeconds
    );
  }

  function silenceAlarm(broadcast) {
    alarmSynth.stop();
    if (!broadcast || !isExtensionContext) return;
    try {
      chrome.runtime.sendMessage({ type: "SILENCE_ALARM" }, () => void chrome.runtime.lastError);
    } catch {
      /* ignore */
    }
  }

  function noteAgentReply() {
    replyQuietUntil = Date.now() + 1500;
    trackers.clear();
    lastMaxWait = 0;
    lastMatchCount = 0;
    lastAlarmActive = false;
    silenceAlarm(true);
    publishStatus(0, 0, false);
  }

  function looksLikeComposer(el) {
    if (!el || el.disabled) return false;
    if (el.type === "number" || el.type === "range") return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    if (tag === "INPUT" && /^(text|search)?$/.test(el.type || "text")) return true;
    return false;
  }

  function looksLikeReplyOrClose(el) {
    if (!el) return false;
    const text = `${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.textContent || ""}`.toLowerCase();
    return /send|gönder|reply|yan[ıi]t|submit|end chat|close chat|sohbeti kapat|sonland[ıi]r/.test(text);
  }

  function bindReplyWatchers() {
    if (replyKeyHandler) return;
    replyKeyHandler = (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      if (looksLikeComposer(event.target)) noteAgentReply();
    };
    replyClickHandler = (event) => {
      const btn = event.target && event.target.closest && event.target.closest("button, [role='button'], input[type='submit']");
      if (btn && looksLikeReplyOrClose(btn)) noteAgentReply();
    };
    document.addEventListener("keydown", replyKeyHandler, true);
    document.addEventListener("click", replyClickHandler, true);
  }

  function bindRuntimeSilence() {
    if (!isExtensionContext || !chrome.runtime?.onMessage || runtimeListener) return;
    runtimeListener = (message) => {
      if (message && message.type === "SILENCE_ALARM") {
        alarmSynth.stop();
      }
    };
    chrome.runtime.onMessage.addListener(runtimeListener);
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
          threshold: settings.alarmThresholdSeconds,
          alive: true,
          href: String(location.href || "")
        },
        () => void chrome.runtime.lastError
      );
    } catch {
      // Extension context invalidated (yenileme / kaldırılma).
      teardown();
    }
  }

  async function scanOnce() {
    if (destroyed) return;
    if (scanning) {
      scanQueued = true;
      return;
    }
    scanning = true;
    try {
      const matches = [];
      const doc = document;
      if (!doc || !doc.documentElement) return;

      const roots = collectRootList(doc);
      for (const root of roots) {
        scanIsolatedCompactBadges(root, matches);
        scanAttributeTimes(root, matches);
        scanPseudoAndAttrs(root, matches);
      }

      const compactMatches = dedupeWaitMatches(matches);
      const { maxWaitTimeSeconds, matchCount, sawReset } = updateTrackers(compactMatches);
      if (sawReset) replyQuietUntil = Math.max(replyQuietUntil, Date.now() + 1200);

      const alarmActive = shouldRing(maxWaitTimeSeconds);

      if (alarmActive) alarmSynth.start();
      else {
        alarmSynth.stop();
        if (lastAlarmActive || sawReset) silenceAlarm(true);
      }

      publishStatus(maxWaitTimeSeconds, matchCount, alarmActive);
    } finally {
      scanning = false;
      if (scanQueued && !destroyed) {
        scanQueued = false;
        scanOnce().catch(() => {});
      }
    }
  }

  function scheduleScan() {
    if (destroyed) return;
    if (scanning) {
      scanQueued = true;
      return;
    }
    if (mutationTimerId) return;
    mutationTimerId = globalThis.setTimeout(() => {
      mutationTimerId = 0;
      scanOnce().catch(() => {});
    }, 80);
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
    if (pointerUnlockHandler) return;
    pointerUnlockHandler = () => globalThis.Comm100AlarmPlayer?.unlock();
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
      let local = {};
      try {
        local = await chrome.storage.local.get({
          customSoundDataUrl: "",
          customSoundName: ""
        });
      } catch {
        local = {};
      }
      applySettings({ ...stored, ...local });
    } catch {
      applySettings(DEFAULT_SETTINGS);
    }
  }

  function listenStorage() {
    if (!isExtensionContext || !chrome.storage?.onChanged) return;
    storageListener = (changes, area) => {
      if (area !== "sync" && area !== "local") return;
      const next = { ...settings };
      if (changes.enabled) next.enabled = changes.enabled.newValue;
      if (changes.alarmThresholdSeconds) next.alarmThresholdSeconds = changes.alarmThresholdSeconds.newValue;
      if (changes.volume) next.volume = changes.volume.newValue;
      if (changes.mutedUntil) next.mutedUntil = changes.mutedUntil.newValue;
      if (changes.soundMode) next.soundMode = changes.soundMode.newValue;
      if (Object.prototype.hasOwnProperty.call(changes, "customSoundDataUrl")) {
        next.customSoundDataUrl = changes.customSoundDataUrl.newValue || "";
      }
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
    if (replyKeyHandler) document.removeEventListener("keydown", replyKeyHandler, true);
    if (replyClickHandler) document.removeEventListener("click", replyClickHandler, true);
    if (runtimeListener && chrome?.runtime?.onMessage) {
      try { chrome.runtime.onMessage.removeListener(runtimeListener); } catch { /* ignore */ }
    }
    globalThis.__COMM100_WAIT_ALARM_LOADED__ = false;
  }

  async function start() {
    await loadSettings();
    listenStorage();
    bindAudioUnlock();
    bindReplyWatchers();
    bindRuntimeSilence();
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
    isCompactBadge,
    compactLabelOf,
    isIgnoredDurationContext,
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
