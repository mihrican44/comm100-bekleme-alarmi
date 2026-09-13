#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const document = {
  readyState: "loading",
  documentElement: {},
  addEventListener() {},
  removeEventListener() {},
  querySelectorAll() { return []; },
  visibilityState: "visible"
};

const sandbox = {
  console,
  chrome: { runtime: {}, storage: { sync: { get: async () => ({}) }, onChanged: { addListener() {} } } },
  document,
  window: {
    addEventListener() {},
    removeEventListener() {}
  },
  NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  MutationObserver: class { observe() {} disconnect() {} },
  setInterval: () => 0,
  setTimeout: () => 0,
  clearInterval() {},
  clearTimeout() {},
  AudioContext: class { close() { return Promise.resolve(); } },
  globalThis: null
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const {
  parseTimeToSeconds,
  extractTimesFromText,
  isCompactBadge,
  compactLabelOf,
  isIgnoredDurationContext,
  isChatWatchUrl
} = sandbox.WaitAlarm;
const cases = [
  ["02:15", 135],
  ["1:02:03", 3723],
  ["2m", 120],
  ["2m 15s", 135],
  ["2m15s", 135],
  ["45s", 45],
  ["12s", 12],
  ["0:00", 0],
  ["bogus", -1],
  ["24:00:00", -1]
];

let failed = 0;
for (const [input, expected] of cases) {
  const actual = parseTimeToSeconds(input);
  if (actual !== expected) {
    failed += 1;
    console.error(`parseTimeToSeconds(${input}) => ${actual}, expected ${expected}`);
  }
}

const extracted = extractTimesFromText("waiting 02:15 and 45s also 1:02:03 and 2m");
const seconds = extracted.map((item) => item.parsedSeconds).sort((a, b) => a - b);
if (JSON.stringify(seconds) !== JSON.stringify([45, 120, 135, 3723])) {
  failed += 1;
  console.error("extractTimesFromText mismatch", extracted);
}

const infoPanel = extractTimesFromText("53 min 43 s");
const infoSecs = infoPanel.map((item) => item.parsedSeconds);
if (infoSecs.includes(43) || infoSecs.includes(3180) || infoSecs.includes(43 + 53 * 60)) {
  failed += 1;
  console.error("info panel duration should be ignored", infoPanel);
}

const compactCases = [
  ["12s", true],
  ["2m", true],
  ["2m15s", true],
  ["43 s", false],
  ["53 min", false],
  ["53 min 43 s", false],
  ["0:43", false],
  ["02:01", false],
  ["43s", true]
];
for (const [input, expected] of compactCases) {
  const actual = Boolean(isCompactBadge(input));
  if (actual !== expected) {
    failed += 1;
    console.error(`isCompactBadge(${input}) => ${actual}, expected ${expected}`);
  }
}

const mixedPage = extractTimesFromText(
  "Chats Ongoing 1 test 12s Canlı Destek Info 53 min 43 s Session 2 Visits"
);
const compactFromPage = mixedPage.filter((item) => isCompactBadge(item.raw)).map((item) => item.parsedSeconds);
if (!compactFromPage.includes(12) || compactFromPage.includes(43) || compactFromPage.includes(3180)) {
  failed += 1;
  console.error("mixed page should keep 12s and drop Info duration", mixedPage);
}

const two = extractTimesFromText("badge 2m15s on the list");
if (!two.some((item) => item.raw === "2m15s" && item.parsedSeconds === 135)) {
  failed += 1;
  console.error("2m15s compact raw should stay unspaced", two);
}

function fakeEl(ownText, parentText) {
  const parent = parentText
    ? {
        nodeType: 1,
        parentElement: null,
        innerText: parentText,
        textContent: parentText,
        getAttribute() { return null; }
      }
    : null;
  return {
    nodeType: 1,
    tagName: "SPAN",
    parentElement: parent,
    children: { length: 0 },
    innerText: ownText,
    textContent: ownText,
    getAttribute() { return null; },
    childNodes: [{ nodeType: 3, nodeValue: ownText }]
  };
}

const listBadge = fakeEl("41s", "test 41s Canlı Destek");
const infoLeaf = fakeEl("53 min 43 s", "Info test 53 min 43 s Custom Field");
const emptyAfterReply = fakeEl("", "test Canlı Destek");
if (compactLabelOf(listBadge) !== "41s") {
  failed += 1;
  console.error("list badge 41s should be read");
}
if (compactLabelOf(infoLeaf) !== "") {
  failed += 1;
  console.error("info duration must not look like a compact badge", compactLabelOf(infoLeaf));
}
if (compactLabelOf(emptyAfterReply) !== "") {
  failed += 1;
  console.error("cleared badge after reply should be empty");
}
if (isIgnoredDurationContext(infoLeaf) !== true) {
  failed += 1;
  console.error("info panel context should be ignored");
}
if (isIgnoredDurationContext(listBadge) !== false) {
  failed += 1;
  console.error("left list badge context should not be ignored");
}

const urlCases = [
  ["https://dash15.lively-chat.com/agentconsole/chats?partnerId=100001", true],
  ["https://dash15.lively-chat.com/agentconsole/chats", true],
  ["https://example.com/other", false],
  ["https://dash15.lively-chat.com/agentconsole/agents", false],
  ["http://127.0.0.1:43147/demo/index.html", true]
];
for (const [href, expected] of urlCases) {
  const actual = Boolean(isChatWatchUrl(href));
  if (actual !== expected) {
    failed += 1;
    console.error(`isChatWatchUrl(${href}) => ${actual}, expected ${expected}`);
  }
}

if (failed) {
  console.error(`FAILED: ${failed} assertion(s)`);
  process.exit(1);
}

console.log("parser tests passed");
