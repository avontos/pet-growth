// Smoke test: extract the inline script from index.html, stub the DOM, and render every view.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("no inline script found");

let src = m[1];
src = src.replace(
  "/* ================= boot =================",
  "globalThis.__TEST = { V, R, matchInfo, allEvents, chart, S };\n  /* ================= boot ================="
);

const el = () => {
  const node = {
    innerHTML: "",
    textContent: "",
    dataset: {},
    scrollTop: 0,
    setAttribute() {},
    addEventListener() {},
    appendChild() {},
    click() {},
    style: {},
  };
  return node;
};

const store = {};
const sandbox = {
  console,
  Math,
  Date,
  JSON,
  Number,
  String,
  Object,
  Array,
  Blob: class {},
  URL: { createObjectURL: () => "blob:", revokeObjectURL() {} },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => (store[k] = String(v)),
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  document: {
    querySelector: () => el(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => el(),
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "app.js" });

const T = sandbox.__TEST;
if (!T) throw new Error("test hook missing");
const names = ["home", "health", "timeline", "community", "me", "about"];
let fail = 0;
for (const n of names) {
  try {
    const out = T.V[n]();
    if (typeof out !== "string" || out.length < 200) throw new Error("suspiciously short: " + out.length);
    console.log(`OK   ${n.padEnd(10)} ${out.length} chars`);
    if (/undefined|NaN|\[object Object\]/.test(out)) {
      console.log(`WARN ${n} contains suspicious token`);
      fail++;
    }
  } catch (e) {
    console.log(`FAIL ${n}: ${e.message}`);
    fail++;
  }
}
try {
  const ev = T.allEvents();
  console.log(`OK   events     ${ev.length} items, latest=${ev[0].d}`);
} catch (e) {
  console.log("FAIL events: " + e.message); fail++;
}
try {
  const list = T.matchInfo({ name: "x", species: "dog", km: 0.3, tags: ["同小区"], shared: "公园" });
  console.log(`OK   match      score=${list.score} reasons=${list.reasons.length}`);
} catch (e) {
  console.log("FAIL match: " + e.message); fail++;
}
console.log(fail === 0 ? "SMOKE PASS" : `SMOKE FAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
