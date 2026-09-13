/**
 * Demo ortamı için chrome.storage / runtime taklidi.
 * Gerçek eklentide bu dosya yüklenmez.
 */
(() => {
  const listeners = new Set();

  function createArea(areaName, initial) {
    const memory = { ...initial };
    return {
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
        for (const fn of listeners) fn(changes, areaName);
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const key of list) {
          changes[key] = { oldValue: memory[key], newValue: undefined };
          delete memory[key];
        }
        for (const fn of listeners) fn(changes, areaName);
      }
    };
  }

  window.chrome = {
    runtime: {
      id: "demo-wait-alarm",
      lastError: null,
      sendMessage() {},
      getURL(path) {
        const clean = String(path || "").replace(/^\//, "");
        return `${location.origin}/${clean}`;
      }
    },
    storage: {
      sync: createArea("sync", {
        enabled: true,
        alarmThresholdSeconds: 120,
        volume: 1,
        mutedUntil: 0,
        soundMode: "builtin"
      }),
      local: createArea("local", {
        customSoundDataUrl: "",
        customSoundName: ""
      }),
      onChanged: {
        addListener(fn) { listeners.add(fn); },
        removeListener(fn) { listeners.delete(fn); }
      }
    }
  };
})();
