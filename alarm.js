/**
 * Yüksek sesli alarm oynatıcı.
 * Varsayılan: paketlenmiş siren WAV (döngü).
 * İsteğe bağlı: kullanıcının yüklediği MP3/WAV/OGG.
 * Dosya çalmazsa Web Audio ile çift tonlu siren yedeği.
 */
(() => {
  "use strict";

  const SIREN_LOW_HZ = 880;
  const SIREN_HIGH_HZ = 1760;
  const SIREN_ON_SEC = 0.42;
  const SIREN_OFF_SEC = 0.12;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function builtinSoundUrl() {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
        return chrome.runtime.getURL("sounds/alarm.wav");
      }
    } catch {
      /* demo veya geçersiz bağlam */
    }
    try {
      return new URL("../sounds/alarm.wav", document.baseURI || location.href).href;
    } catch {
      return "sounds/alarm.wav";
    }
  }

  const player = {
    volume: 1,
    soundMode: "builtin",
    customSoundDataUrl: "",
    playing: false,
    unlockBound: false,
    audioEl: null,
    ctx: null,
    master: null,
    oscLow: null,
    oscHigh: null,
    sirenTimer: 0,
    sirenOn: false,
    usingFallback: false,
    testTimer: 0,
    playGen: 0,

    hardPause(el) {
      if (!el) return;
      try {
        el.pause();
        el.muted = true;
        el.volume = 0;
        el.loop = false;
        el.currentTime = 0;
        el.removeAttribute("src");
        el.src = "";
        el.load();
      } catch {
        /* ignore */
      }
    },

    configure(next) {
      if (!next || typeof next !== "object") return;
      if (Number.isFinite(Number(next.volume))) this.volume = clamp(Number(next.volume), 0, 1);
      if (next.soundMode === "custom" || next.soundMode === "builtin") this.soundMode = next.soundMode;
      if (typeof next.customSoundDataUrl === "string") this.customSoundDataUrl = next.customSoundDataUrl;
      if (this.audioEl) this.audioEl.volume = this.volume;
      if (this.master && this.ctx) {
        try {
          this.master.gain.setTargetAtTime(this.playing ? this.sirenGain() : 0, this.ctx.currentTime, 0.02);
        } catch {
          /* ignore */
        }
      }
      if (this.playing) {
        const src = this.activeSource();
        if (this.audioEl && this.audioEl.src !== src && !this.usingFallback) {
          this.stop();
          this.start();
        }
      }
    },

    activeSource() {
      if (this.soundMode === "custom" && this.customSoundDataUrl) return this.customSoundDataUrl;
      return builtinSoundUrl();
    },

    sirenGain() {
      return clamp(this.volume, 0, 1) * 0.85;
    },

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

    ensureAudio() {
      if (this.audioEl) return this.audioEl;
      const el = new Audio();
      el.preload = "none";
      el.loop = true;
      el.muted = true;
      el.volume = 0;
      el.addEventListener("error", () => {
        if (this.playing) this.startSirenFallback();
      });
      this.audioEl = el;
      return el;
    },

    unlock() {
      // Eşik dolmadan asla alarm dosyasını çalma; yalnızca ses bağlamını aç.
      const ctx = this.ensureContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      try {
        const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.buffer = buffer;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        src.onended = () => {
          try { src.disconnect(); } catch { /* ignore */ }
          try { gain.disconnect(); } catch { /* ignore */ }
        };
      } catch {
        /* sessiz kilit açma başarısız olsa da start() yine dener */
      }
    },

    start() {
      if (this.playing) return;
      this.playing = true;
      this.usingFallback = false;
      this.playGen += 1;
      const gen = this.playGen;
      const el = this.ensureAudio();
      const src = this.activeSource();
      try {
        el.src = src;
        el.loop = true;
        el.muted = false;
        el.volume = this.volume;
        el.currentTime = 0;
        const playResult = el.play();
        if (playResult && typeof playResult.then === "function") {
          playResult.then(() => {
            if (!this.playing || this.playGen !== gen) this.hardPause(el);
          }).catch(() => {
            if (this.playing && this.playGen === gen) this.startSirenFallback();
          });
        }
      } catch {
        if (this.playing && this.playGen === gen) this.startSirenFallback();
      }
    },

    startSirenFallback() {
      if (!this.playing) return;
      this.usingFallback = true;
      this.hardPause(this.audioEl);
      const ctx = this.ensureContext();
      if (!ctx) return;
      this.stopSirenNodes();

      const master = ctx.createGain();
      const oscLow = ctx.createOscillator();
      const oscHigh = ctx.createOscillator();
      oscLow.type = "square";
      oscHigh.type = "square";
      oscLow.frequency.setValueAtTime(SIREN_LOW_HZ, ctx.currentTime);
      oscHigh.frequency.setValueAtTime(SIREN_HIGH_HZ, ctx.currentTime);
      master.gain.setValueAtTime(this.sirenGain(), ctx.currentTime);
      oscLow.connect(master);
      oscHigh.connect(master);
      master.connect(ctx.destination);
      oscLow.start();
      oscHigh.start();
      this.master = master;
      this.oscLow = oscLow;
      this.oscHigh = oscHigh;
      this.sirenOn = true;
      this.pulseSiren();
    },

    pulseSiren() {
      if (this.sirenTimer) {
        globalThis.clearInterval(this.sirenTimer);
        this.sirenTimer = 0;
      }
      this.sirenTimer = globalThis.setInterval(() => {
        if (!this.playing || !this.ctx || !this.master) return;
        this.sirenOn = !this.sirenOn;
        const now = this.ctx.currentTime;
        const target = this.sirenOn ? this.sirenGain() : 0.0001;
        try {
          this.master.gain.cancelScheduledValues(now);
          this.master.gain.setValueAtTime(this.master.gain.value || target, now);
          this.master.gain.exponentialRampToValueAtTime(target, now + 0.03);
          if (this.oscLow && this.oscHigh) {
            const low = this.sirenOn ? SIREN_HIGH_HZ : SIREN_LOW_HZ;
            const high = this.sirenOn ? SIREN_LOW_HZ * 2 : SIREN_HIGH_HZ;
            this.oscLow.frequency.setValueAtTime(low, now);
            this.oscHigh.frequency.setValueAtTime(high, now);
          }
        } catch {
          /* ignore */
        }
      }, Math.round((SIREN_ON_SEC + SIREN_OFF_SEC) * 1000 / 2));
    },

    stopSirenNodes() {
      if (this.sirenTimer) {
        globalThis.clearInterval(this.sirenTimer);
        this.sirenTimer = 0;
      }
      const nodes = [this.oscLow, this.oscHigh, this.master];
      for (const node of nodes) {
        if (!node) continue;
        try { if (node.stop) node.stop(); } catch { /* already stopped */ }
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
      this.oscLow = null;
      this.oscHigh = null;
      this.master = null;
      this.sirenOn = false;
    },

    stop() {
      this.playing = false;
      this.usingFallback = false;
      this.playGen += 1;
      if (this.testTimer) {
        globalThis.clearTimeout(this.testTimer);
        this.testTimer = 0;
      }
      this.hardPause(this.audioEl);
      this.stopSirenNodes();
    },

    test(ms = 2500) {
      this.stop();
      this.start();
      this.testTimer = globalThis.setTimeout(() => this.stop(), ms);
    },

    dispose() {
      this.stop();
      if (this.audioEl) {
        this.audioEl.src = "";
        this.audioEl = null;
      }
      if (this.ctx && this.ctx.state !== "closed") {
        this.ctx.close().catch(() => {});
      }
      this.ctx = null;
    }
  };

  globalThis.Comm100AlarmPlayer = player;
})();
