const $ = (s, r = document) => r.querySelector(s);
const root = document.documentElement;
const editor = $("#editor");
const greet = $("#greet");
const minimap = $("#minimap");
const canvas = $("#map");
const frame = $("#mapFrame");

const PREFS_KEY = "typeaway.prefs.v1";
let greetEl = greet;

const prefs = Object.assign(
  { theme: "system", font: "serif", sound: "off" },
  JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")
);
const savePrefs = () => localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));

function applyPrefs() {
  root.dataset.theme = prefs.theme;
  root.dataset.font = prefs.font;
  root.dataset.sound = prefs.sound;
  document.querySelectorAll(".slot").forEach((slot) => {
    const group = slot.dataset.group;
    slot.querySelectorAll(".opts button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.value === prefs[group]));
    });
  });
}

function setPref(group, value) {
  prefs[group] = value;
  savePrefs();
  applyPrefs();
  if (group === "sound" && value !== "off") playKey("space");
  if (group === "font" || group === "theme") requestAnimationFrame(drawMap);
}

const slots = Array.from(document.querySelectorAll(".slot"));

function closeSlots(except) {
  slots.forEach((slot) => {
    if (slot === except) return;
    slot.classList.remove("open");
    slot.querySelector(".icon").setAttribute("aria-expanded", "false");
  });
}

slots.forEach((slot) => {
  const icon = slot.querySelector(".icon");
  icon.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !slot.classList.contains("open");
    closeSlots(slot);
    slot.classList.toggle("open", open);
    icon.setAttribute("aria-expanded", String(open));
  });
  slot.querySelectorAll(".opts button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setPref(slot.dataset.group, btn.dataset.value);
    });
  });
});

document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".slot")) closeSlots(null);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.querySelector(".slot.open")) {
    closeSlots(null);
    editor.focus();
  }
});

localStorage.removeItem("typeaway.greet.v1");

applyPrefs();

try { audio(); } catch (_) {}

let txt = "";
function readText() {
  txt = editor.innerText.replace(/\r/g, "");
}

function dropGreeting() {
  if (!greetEl) return;
  const before = editor.getBoundingClientRect().top;
  greetEl.remove();
  greetEl = null;
  const shift = before - editor.getBoundingClientRect().top;
  if (shift) window.scrollBy(0, -shift);
}

window.addEventListener("scroll", () => {
  if (greetEl && greetEl.getBoundingClientRect().bottom < 0) dropGreeting();
}, { passive: true });

editor.addEventListener("beforeinput", (e) => {
  if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
    e.preventDefault();
    document.execCommand("insertLineBreak");
  }
});

editor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, text);
});

editor.addEventListener("input", () => {
  readText();
  queueMap();
});

document.addEventListener("selectionchange", () => {
  if (document.activeElement === editor) keepCaretInView();
});

const veilTop = $(".veil-top");

function keepCaretInView() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect || (!rect.height && !rect.top)) return;
  const h = window.innerHeight;
  const veil = veilTop ? veilTop.getBoundingClientRect().height : h * 0.34;
  const top = rect.top, bottom = rect.bottom;
  if (bottom > h * 0.66) window.scrollBy(0, bottom - h * 0.56);
  else if (top < veil * 1.02) window.scrollBy(0, top - veil * 1.08);
}

function caretAt(x, y) {
  const r = editor.getBoundingClientRect();
  const cx = Math.min(Math.max(x, r.left + 2), r.right - 2);
  const cy = Math.min(Math.max(y, r.top + 2), r.bottom - 2);

  let node = null, offset = 0;
  if (document.caretRangeFromPoint) {
    const hit = document.caretRangeFromPoint(cx, cy);
    if (hit) { node = hit.startContainer; offset = hit.startOffset; }
  } else if (document.caretPositionFromPoint) {
    const hit = document.caretPositionFromPoint(cx, cy);
    if (hit) { node = hit.offsetNode; offset = hit.offset; }
  }

  editor.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  const range = document.createRange();
  if (node && editor.contains(node)) {
    range.setStart(node, offset);
    range.collapse(true);
  } else {
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  sel.addRange(range);
  keepCaretInView();
}

document.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (e.target.closest(".dock, .minimap")) return;
  if (editor.contains(e.target)) return;
  e.preventDefault();
  caretAt(e.clientX, e.clientY);
});

let ac = null, master = null, noiseBuf = null;

const samples = { keypress: null, return: null, thock: [], cream: [], thockspace: null, thockenter: null, creamspace: null, creamenter: null };
let samplesAsked = false;

function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ac = new Ctx();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
    const len = Math.floor(ac.sampleRate * 0.4);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    loadSamples();
  }
  if (ac.state === "suspended") ac.resume();
  return ac;
}

function fetchSample(path) {
  return fetch(path)
    .then((r) => r.arrayBuffer())
    .then((buf) => ac.decodeAudioData(buf))
    .catch(() => null);
}

function loadSamples() {
  if (samplesAsked) return;
  samplesAsked = true;
  fetchSample("audio/keypress.mp3").then((b) => { if (b) samples.keypress = b; });
  fetchSample("audio/return.mp3").then((b) => { if (b) samples.return = b; });
  for (const kind of ["thock", "cream"]) {
    for (let i = 1; i <= 12; i++) {
      fetchSample("audio/" + kind + "-" + i + ".wav").then((b) => { if (b) samples[kind].push(b); });
    }
    for (const k of ["space", "enter"]) {
      fetchSample("audio/" + kind + "-" + k + ".wav").then((b) => { if (b) samples[kind + k] = b; });
    }
  }
}

const HEAVY_KEYS = new Set([" ", "space", "Enter", "enter", "Backspace", "Tab", "Delete"]);

function keyHash(k) {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) {
    h ^= k.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function pickIndex(kind, key) {
  const pool = samples[kind];
  if (!pool.length) return -1;
  if (HEAVY_KEYS.has(key)) return pool.length - 1;
  return keyHash(key) % Math.max(1, pool.length - 1);
}

function playHit(kind, key) {
  const pool = samples[kind];
  const i = pickIndex(kind, key);
  if (i < 0) return false;
  return playSample(pool[i], HEAVY_KEYS.has(key) ? 1.12 : 1, 1);
}

function playSample(buf, gain = 1, rate = 1) {
  if (!buf || !buf.length) return false;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(g).connect(master);
  src.start();
  return true;
}

function noise({ dur = 0.05, gain = 0.4, freq = 900, sweepTo = 0, q = 1, type = "bandpass", at = ac.currentTime, attack = 0.0015 }) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, at);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(master);
  src.start(at); src.stop(at + dur + 0.02);
}

function tone({ freq = 180, to = 0.72, dur = 0.08, gain = 0.2, type = "sine", at = ac.currentTime, attack = 0.003 }) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (to !== 1) o.frequency.exponentialRampToValueAtTime(freq * to, at + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}

const SOUNDS = {
  thock(key, v, raw) {
    if (playHit("thock", raw || key)) return;
    const at = ac.currentTime + 0.001;
    const p = 0.95 + Math.random() * 0.1;
    const deep = key === "space" ? 0.86 : key === "enter" ? 0.82 : 1;

    noise({ dur: 0.004, gain: 0.012 * v, freq: 4200, type: "highpass", at });
    const hit = at + 0.008;
    tone({ freq: 74 * p * deep, to: 0.7, dur: 0.1, gain: 0.11 * v, at: hit, attack: 0.002 });
    tone({ freq: 150 * p * deep, to: 0.52, dur: 0.14, gain: 0.4 * v, at: hit, attack: 0.002 });
    tone({ freq: 300 * p * deep, to: 0.62, dur: 0.07, gain: 0.08 * v, at: hit });
    noise({ dur: 0.09, gain: 0.3 * v, freq: 760 * p, sweepTo: 210, q: 0.8, type: "lowpass", at: hit });
    noise({ dur: 0.03, gain: 0.08 * v, freq: 1150 * p, q: 1.4, at: hit });
    noise({ dur: 0.02, gain: 0.055 * v, freq: 3100 * p, q: 1.1, at: hit });
  },
  cream(key, v, raw) {
    if (playHit("cream", raw || key)) return;
    const at = ac.currentTime + 0.001;
    const p = 0.97 + Math.random() * 0.05;
    const deep = key === "space" ? 0.9 : 1;

    tone({ freq: 190 * p * deep, to: 0.88, dur: 0.105, gain: 0.26 * v, at, attack: 0.009 });
    tone({ freq: 380 * p * deep, to: 0.92, dur: 0.06, gain: 0.07 * v, at, attack: 0.009 });
    noise({ dur: 0.075, gain: 0.19 * v, freq: 1500 * p, sweepTo: 650, q: 0.7, type: "lowpass", at, attack: 0.008 });
    noise({ dur: 0.05, gain: 0.16 * v, freq: 1200 * p, q: 1.2, at, attack: 0.007 });
    noise({ dur: 0.035, gain: 0.11 * v, freq: 2600 * p, q: 1.4, at, attack: 0.006 });
  },
  typewriter(key, v) {
    const rate = 0.96 + Math.random() * 0.08;
    if (key === "enter") {
      if (playSample(samples.return, 2.1 * v, 1 - Math.random() * 0.03)) {
        playSample(samples.keypress, 0.7 * v, rate);
        return;
      }
    } else if (playSample(samples.keypress, (key === "space" ? 1.15 : 0.95) * v, key === "space" ? rate * 0.9 : rate)) {
      return;
    }

    const at = ac.currentTime + 0.001;
    const p = 0.96 + Math.random() * 0.08;
    noise({ dur: 0.01, gain: 0.32 * v, freq: 4800 * p, q: 0.7, type: "highpass", at });
    noise({ dur: 0.048, gain: 0.22 * v, freq: 1750 * p, q: 3.6, at });
    tone({ freq: 2300 * p, to: 0.92, dur: 0.07, gain: 0.05 * v, type: "triangle", at });
    tone({ freq: 148 * p, to: 0.75, dur: 0.055, gain: 0.08 * v, at });
    if (key === "enter") {
      tone({ freq: 1568, to: 1, dur: 1.1, gain: 0.16 * v, at: at + 0.02 });
      tone({ freq: 2093, to: 1, dur: 0.8, gain: 0.07 * v, at: at + 0.02 });
    }
  },
};

function playKey(key = "a") {
  const play = SOUNDS[prefs.sound];
  if (!play) return;
  const type = key === " " || key === "space" ? "space" : key === "Enter" || key === "enter" ? "enter" : "char";
  try {
    audio();
    play(type, 0.9 + Math.random() * 0.2, key);
  } catch (_) {}
}

window.addEventListener("pointerdown", () => audio(), { once: true, capture: true });
window.addEventListener("keydown", () => audio(), { once: true, capture: true });

editor.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key.length === 1 || HEAVY_KEYS.has(e.key)) playKey(e.key);
});

const MAP_FONT = 'ui-monospace, "iA Writer Mono S", "Noto Sans Mono", monospace';
const MAP_SCREENS = 4;

const mapMaxH = () => Math.min(window.innerHeight * 0.3, 240);
const mapW = () => Math.min(84, Math.max(56, window.innerWidth * 0.072));

const metricCtx = document.createElement("canvas").getContext("2d");
const st = { size: 0, pitch: 0, scale: 0, winTop: 0, windowH: 0, width: 0, height: 0, cols: 0, lineH: 0, top: 0 };

function editorCols() {
  const cs = getComputedStyle(editor);
  metricCtx.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
  const probe = "the quick brown fox jumps over the lazy dog";
  const avg = metricCtx.measureText(probe).width / probe.length;
  const width = editor.getBoundingClientRect().width || 620;
  return Math.max(12, Math.floor(width / avg));
}

function wrapLine(line, cols) {
  if (!line.length) return [""];
  const out = [];
  let rest = line;
  while (rest.length > cols) {
    let cut = rest.lastIndexOf(" ", cols);
    if (cut <= 0) cut = cols;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ +/, "");
  }
  out.push(rest);
  return out;
}

let wrapCache = { text: null, cols: 0, lines: [] };

function visualLines(cols) {
  if (wrapCache.text === txt && wrapCache.cols === cols) return wrapCache.lines;
  const lines = [];
  for (const para of (txt || "").split("\n")) lines.push(...wrapLine(para, cols));
  wrapCache = { text: txt, cols, lines };
  return lines;
}

function computeMap() {
  const cs = getComputedStyle(editor);
  const viewH = window.innerHeight;
  st.lineH = parseFloat(cs.lineHeight) || 30;
  st.width = mapW();
  st.height = Math.round(mapMaxH());
  st.cols = editorCols();
  st.top = editor.getBoundingClientRect().top + window.scrollY;

  const winLines = Math.max(18, (viewH * MAP_SCREENS) / st.lineH);
  const sizeV = st.height / (winLines * 1.42);
  const sizeH = st.width / Math.max(1, st.cols * 0.6);
  st.size = Math.max(1.35, Math.min(4.6, sizeV, sizeH));
  st.pitch = st.size * 1.42;
  st.scale = st.pitch / st.lineH;
  st.windowH = st.height / st.scale;
  st.winTop = window.scrollY + viewH / 2 - st.windowH / 2;
}

function drawMap() {
  computeMap();
  const lines = visualLines(st.cols);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = st.width, H = st.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "400 " + st.size + "px " + MAP_FONT;
  ctx.textBaseline = "top";

  const ink = getComputedStyle(root).getPropertyValue("--ink").trim() || "#888";
  ctx.fillStyle = ink;

  const edge = H * 0.18;
  const from = Math.max(0, Math.floor((st.winTop - st.top) / st.lineH));
  const to = Math.min(lines.length, Math.ceil((st.winTop + st.windowH - st.top) / st.lineH) + 1);
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const y = (st.top + i * st.lineH - st.winTop) * st.scale;
    const fall = Math.min(1, Math.max(0, Math.min(y / edge, (H - y) / edge)));
    if (fall <= 0.01) continue;
    ctx.globalAlpha = 0.62 * fall * fall;
    ctx.fillText(line, 0, y);
  }
  ctx.globalAlpha = 1;

  const enough = (txt || "").trim().length > 250 || document.documentElement.scrollHeight > window.innerHeight * 1.6;
  if (!enough) {
    minimap.hidden = true;
    minimap.classList.remove("on");
    return;
  }
  minimap.hidden = false;
  minimap.classList.add("on");
  updateFrame();
}

let mapTimer = 0;
function queueMap() {
  clearTimeout(mapTimer);
  mapTimer = setTimeout(drawMap, 110);
}

function updateFrame() {
  if (minimap.hidden) return;
  const top = (window.scrollY - st.winTop) * st.scale;
  frame.style.top = top + "px";
  frame.style.height = Math.max(8, window.innerHeight * st.scale) + "px";
  frame.style.left = canvas.offsetLeft - 6 + "px";
  frame.style.width = canvas.offsetWidth + 12 + "px";
  frame.style.right = "auto";
}

let pendingMap = 0;
function scheduleMap() {
  if (pendingMap) return;
  pendingMap = requestAnimationFrame(() => {
    pendingMap = 0;
    drawMap();
  });
  setTimeout(() => {
    if (!pendingMap) return;
    cancelAnimationFrame(pendingMap);
    pendingMap = 0;
    drawMap();
  }, 90);
}

let dragging = false;
function jumpTo(e) {
  const r = canvas.getBoundingClientRect();
  const rel = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
  window.scrollTo({ top: st.winTop + rel * st.windowH - window.innerHeight / 2 });
}
minimap.addEventListener("pointerdown", (e) => {
  dragging = true;
  minimap.setPointerCapture(e.pointerId);
  jumpTo(e);
});
minimap.addEventListener("pointermove", (e) => dragging && jumpTo(e));
minimap.addEventListener("pointerup", (e) => {
  dragging = false;
  minimap.releasePointerCapture(e.pointerId);
});

window.addEventListener("scroll", scheduleMap, { passive: true });

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(drawMap, 120);
});

window.addEventListener("load", () => {
  readText();
  drawMap();
  window.scrollTo(0, 0);
});
