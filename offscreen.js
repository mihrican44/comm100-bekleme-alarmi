(() => {
  "use strict";

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "OFFSCREEN_PLAY") {
      globalThis.Comm100AlarmPlayer?.configure(message.config || {});
      globalThis.Comm100AlarmPlayer?.unlock();
      globalThis.Comm100AlarmPlayer?.start();
    }
    if (message.type === "OFFSCREEN_STOP") {
      globalThis.Comm100AlarmPlayer?.stop();
    }
  });
})();
