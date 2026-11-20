import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8123;
const CDP_PORT = 9333;
const ROOT = new URL("..", import.meta.url).pathname;

const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], {
  cwd: ROOT, stdio: "ignore",
});
const chrome = spawn("chromium", [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, "--no-first-run",
  "--no-default-browser-check", "--disable-extensions", "--window-size=1440,900",
  "--force-device-scale-factor=1", "--user-data-dir=/tmp/typeaway-bench-profile", "about:blank",
], { stdio: "ignore" });

let ws, nextId = 1;
const pending = new Map();
const send = (method, params = {}) => {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
};

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
        ws.onmessage = (m) => {
          const msg = JSON.parse(m.data);
          const slot = msg.id && pending.get(msg.id);
          if (!slot) return;
          pending.delete(msg.id);
          msg.error ? slot.rej(new Error(JSON.stringify(msg.error))) : slot.res(msg.result);
        };
        return;
      }
    } catch {}
    await sleep(150);
  }
  throw new Error("chromium did not come up");
}

async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}

async function goTo(url) {
  await send("Page.navigate", { url });
  for (let i = 0; i < 300; i++) {
    if (await evaluate("document.readyState === 'complete'").catch(() => false)) break;
    await sleep(50);
  }
  await sleep(300);
}

const PROSE = "The page keeps going and the words keep coming, one after another, without a bottom. ";

const SETUP = `
window.__m = { read: [], map: [], block: [], raf: [], long: [] };
window.__text = (n) => { let s = ""; while (s.length < n) s += ${JSON.stringify(PROSE)}; return s.slice(0, n); };
window.__fill = (n, useFontCss) => {
  editor.textContent = __text(n);
  readText();
  wrapCache.text = null;
  window.scrollTo(0, 0);
};
window.__reset = () => { __m = { read: [], map: [], block: [], raf: [], long: [] }; };
window.__caretEnd = () => {
  const r = document.createRange();
  r.selectNodeContents(editor); r.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r); editor.focus();
};
window.__mode = (mode) => {
  const origRead = window.__origRead || (window.__origRead = readText);
  const origQueue = window.__origQueue || (window.__origQueue = queueMap);
  window.__m.read = [];
  if (mode === "app") {
    window.readText = origRead;
    window.queueMap = origQueue;
    window.__recordRead = false;
  } else if (mode === "instrumented") {
    window.readText = () => {
      const t0 = performance.now();
      origRead();
      __m.read.push(+(performance.now() - t0).toFixed(2));
    };
    window.queueMap = () => {
      const t0 = performance.now();
      origQueue();
      __m.map.push(+(performance.now() - t0).toFixed(2));
    };
  } else if (mode === "textcontent") {
    window.readText = () => {
      const t0 = performance.now();
      txt = editor.textContent.replace(/\\r/g, "");
      __m.read.push(+(performance.now() - t0).toFixed(2));
    };
    window.queueMap = () => {
      const t0 = performance.now();
      origQueue();
      __m.map.push(+(performance.now() - t0).toFixed(2));
    };
  } else if (mode === "off") {
    window.readText = () => {};
    window.queueMap = () => {};
  }
  return mode;
};
new PerformanceObserver((l) => l.getEntries().forEach((e) => __m.long.push(+e.duration.toFixed(1))))
  .observe({ type: "longtask" });
editor.addEventListener("input", (e) => {
  const t0 = e.timeStamp;
  setTimeout(() => __m.block.push(+(performance.now() - t0).toFixed(2)), 0);
  requestAnimationFrame(() => __m.raf.push(+(performance.now() - t0).toFixed(2)));
});
"ok"
`;

const KEYA = { text: "a", unmodifiedText: "a", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 };

async function run(n, mode, keys = 20) {
  await evaluate(`__fill(${n}); __mode(${JSON.stringify(mode)}); __reset(); __caretEnd(); "ok"`);
  for (let i = 0; i < keys; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...KEYA });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
    await sleep(45);
  }
  await sleep(600);
  return evaluate(`(() => {
    const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(1); };
    const max = (a) => a.length ? +Math.max(...a).toFixed(1) : null;
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    return {
      read: med(__m.read), readMax: max(__m.read), readSum: +sum(__m.read).toFixed(0),
      map: med(__m.map), mapMax: max(__m.map),
      block: med(__m.block), blockMax: max(__m.block),
      raf: med(__m.raf), rafMax: max(__m.raf),
      slow: __m.raf.filter((v) => v > 16).length, rafN: __m.raf.length,
      long: max(__m.long), longCount: __m.long.length,
      longAll: [...__m.long].sort((a, b) => b - a).slice(0, 4),
      chars: txt.length,
      nodes: editor.childNodes.length,
    };
  })()`);
}

const pad = (s, w) => String(s ?? "—").padStart(w);

async function main() {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  const url = `http://127.0.0.1:${PORT}/index.html`;
  await goTo(url);
  await evaluate(`localStorage.clear(); "ok"`);
  await goTo(url);
  await evaluate(SETUP);

  const sizes = [50000, 100000, 200000, 300000, 500000, 750000, 1000000, 1500000];

  console.log("\n### keystroke latency sweep — 20 real keydowns per size, typed at the end of the doc");
  console.log(" chars  | readText | drawMap | typeAway total | input->idle | frame p50/p95 | frames>16ms | worst task");
  console.log("--------+----------+---------+----------------+-------------+---------------+-------------+-----------");
  for (const n of sizes) {
    const r = await run(n, "instrumented");
    const own = +((r.read ?? 0) + (r.map ?? 0)).toFixed(1);
    console.log(
      `${pad(n, 7)} | ${pad(r.read, 6)} ms | ${pad(r.map, 5)} ms | ${pad(own, 11)} ms | ${pad(r.block, 8)} ms | ${pad(r.raf, 5)}/${pad(r.rafMax, 5)} ms | ${pad(r.slow + "/" + r.rafN, 8)}    | ${pad(r.long, 5)} ms`
    );
  }

  console.log("\n### same keystrokes, typeAway handlers disabled (pure browser editing cost)");
  console.log(" chars  | input->idle | frame p50 | frames>16ms | long tasks");
  console.log("--------+-------------+-----------+-------------+-----------");
  for (const n of [100000, 300000, 500000, 1000000, 1500000]) {
    const r = await run(n, "off");
    console.log(`${pad(n, 7)} | ${pad(r.block, 8)} ms | ${pad(r.raf, 6)} ms | ${pad(r.slow + "/" + r.rafN, 8)}    | ${JSON.stringify(r.longAll)}`);
  }
}

try {
  await main();
} catch (e) {
  console.error("BENCH FAILED:", e.message);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch {}
  chrome.kill("SIGKILL");
  server.kill("SIGKILL");
  await sleep(200);
  process.exit(process.exitCode || 0);
}
