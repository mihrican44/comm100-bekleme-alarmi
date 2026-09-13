(() => {
  "use strict";

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "OFFSCREEN_PLAY") {
      globalThis.WaitAlarmPlayer?.configure(message.config || {});
      globalThis.WaitAlarmPlayer?.unlock();
      globalThis.WaitAlarmPlayer?.start();
    }
    if (message.type === "OFFSCREEN_STOP") {
      globalThis.WaitAlarmPlayer?.stop();
    }
  });
})();
