/**
 * Demo ortamı için chrome.storage / runtime taklidi.
 * Gerçek eklentide bu dosya yüklenmez.
 */
(() => {
  const memory = {
    enabled: true,
    alarmThresholdSeconds: 120,
    volume: 0.55,
    mutedUntil: 0
  };
  const listeners = new Set();

  const storageArea = {
    async get(keys) {
      if (!keys) return { ...memory };
      if (typeof keys === "string") return { [keys]: memory[keys] };
      if (Array.isArray(keys)) {
        const out = {};
        for (const key of keys) out[key] = memory[key];
        return out;
      }
      const out = { ...keys };
      for (const key of Object.keys(keys)) {
        if (key in memory) out[key] = memory[key];
      }
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: memory[key], newValue: value };
        memory[key] = value;
      }
      for (const fn of listeners) fn(changes, "sync");
    }
  };

  window.chrome = {
    runtime: {
      id: "demo-comm100-wait-alarm",
      lastError: null,
      sendMessage() {}
    },
    storage: {
      sync: storageArea,
      onChanged: {
        addListener(fn) { listeners.add(fn); },
        removeListener(fn) { listeners.delete(fn); }
      }
    }
  };
})();
