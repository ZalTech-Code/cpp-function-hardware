// dashboard.js — Web Serial bridge for the "Dashboard Arduino Only" page.
//
// Stripped-down, single-board version of the main dashboard:
//   * Board is FIXED to Arduino Uno R3 (no selector, no auto-detect needed —
//     but a BOARD; line from the firmware is still recognised and logged).
//   * Speaks ONLY the 09_nonblocking_cloud.ino protocol:
//       Board -> browser:  STATUS;uptime=<ms>;led=<0|1>;blinks=<n>;sensor=0
//                          BOARD;name=...;adcmax=...
//                          FLOW;evt=<enter|call|exit>;fn=<name>[;key=val]
//       Browser -> board:  CMD;led=<0|1>  CMD;blink=<n>  CMD;interval=<ms>
//   * The Live Function Flow panel is the centerpiece: a function diagram
//     highlights the active function and a breadcrumb shows the current
//     loop() -> fn() transition, plus the scrolling color-coded event feed.

"use strict";

// ---- Element references ----
const el = {
  connectBtn:     document.getElementById("connect-btn"),
  disconnectBtn:  document.getElementById("disconnect-btn"),
  statusDot:      document.getElementById("status-dot"),
  statusText:     document.getElementById("status-text"),
  ledIndicator:   document.getElementById("led-indicator"),
  ledValue:       document.getElementById("led-value"),
  uptimeValue:    document.getElementById("uptime-value"),
  blinksValue:    document.getElementById("blinks-value"),
  ledOnBtn:       document.getElementById("led-on-btn"),
  ledOffBtn:      document.getElementById("led-off-btn"),
  blinkCount:     document.getElementById("blink-count"),
  blinkBtn:       document.getElementById("blink-btn"),
  intervalMs:     document.getElementById("interval-ms"),
  intervalBtn:    document.getElementById("interval-btn"),
  blockDiagram:   document.getElementById("block-diagram"),
  flowBreadcrumb: document.getElementById("flow-breadcrumb"),
  codeContent:    document.getElementById("code-content"),
  flowFeed:       document.getElementById("flow-feed"),
  flowPause:      document.getElementById("flow-pause"),
  flowClearBtn:   document.getElementById("flow-clear-btn"),
  flowStepMode:   document.getElementById("flow-step-mode"),
  flowStepBtn:    document.getElementById("flow-step-btn"),
  flowPlayBtn:    document.getElementById("flow-play-btn"),
  flowSpeed:      document.getElementById("flow-speed"),
  flowQueueInfo:  document.getElementById("flow-queue-info"),
  traceBtn:       document.getElementById("trace-btn"),
  tracePace:      document.getElementById("trace-pace"),
  tracePaceVal:   document.getElementById("trace-pace-val"),
  log:            document.getElementById("log"),
  clearLogBtn:    document.getElementById("clear-log-btn"),
};

// ---- Board profile: fixed to Uno R3 ----
const BOARD = { name: "Arduino Uno R3", adcMax: 1023 };

// ---- Connection state ----
let port = null;
let reader = null;
let writer = null;
let keepReading = false;
let lineBuffer = "";

// ---- Logging ----
function log(msg) {
  const time = new Date().toLocaleTimeString();
  el.log.textContent += `[${time}] ${msg}\n`;
  el.log.scrollTop = el.log.scrollHeight;
}

// Escape HTML entities to prevent XSS when rendering untrusted data
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---- UI: reflect connection status ----
function setConnected(connected) {
  el.statusDot.classList.toggle("on", connected);
  el.statusDot.classList.toggle("off", !connected);
  el.statusText.textContent = connected ? "Connected" : "Disconnected";
  el.connectBtn.disabled = connected;
  el.disconnectBtn.disabled = !connected;
  [el.ledOnBtn, el.ledOffBtn, el.blinkBtn, el.intervalBtn, el.traceBtn].forEach(
    (b) => (b.disabled = !connected)
  );
  el.flowClearBtn.disabled = !connected || !el.flowFeed.querySelector(".flow-row");
  if (!connected) {
    resetFlowStage();
    traceOn = false;
    el.traceBtn.textContent = "▶ Start real-time trace";
    el.traceBtn.classList.remove("tracing");
  }
}

// ---- Parse "PREFIX;k=v;k=v" lines into a key/value object ----
function parseKv(line) {
  const data = {};
  for (const part of line.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) data[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return data;
}

// ---- Update the dashboard cards from a STATUS line ----
function updateUI(data) {
  if ("led" in data) {
    const on = data.led === "1";
    el.ledIndicator.classList.toggle("on", on);
    el.ledIndicator.classList.toggle("off", !on);
    el.ledValue.textContent = on ? "ON" : "OFF";
  }
  if ("uptime" in data) {
    el.uptimeValue.textContent = (Number(data.uptime) / 1000).toFixed(1);
  }
  if ("blinks" in data) {
    el.blinksValue.textContent = data.blinks;
  }
}

// ---- Handle a full line received from the board ----
function handleLine(line) {
  line = line.trim();
  if (!line) return;

  if (line.startsWith("BOARD;")) {
    const d = parseKv(line.slice(6));
    log(`board announced: ${d.name || "?"} (ADC max ${d.adcmax || "?"}) — dashboard is fixed to ${BOARD.name}`);
    return;
  }

  if (line.startsWith("FLOW;")) {
    handleFlow(line);
    return;
  }

  if (line.startsWith("STATUS;")) {
    updateUI(parseKv(line));
    return;
  }

  if (line.startsWith("READY;")) {
    log("board ready: " + line.slice(6));
    return;
  }

  log("board: " + line); // anything else (debug prints)
}

// ---- Live function flow ----
const FLOW_MAX_ROWS = 60;      // keep the DOM small
const FLOW_ACTIVE_MS = 600;    // how long a diagram node stays highlighted (live mode)
let flowNewestOnTop = true;
const flowTimers = {};         // fn -> timeout id, for node highlight decay
let currentFlowRow = null;     // the feed row for the most recent event

// Step mode: queue events and apply them one at a time.
let flowQueue = [];
let flowStepIndex = 0;
let flowPlaying = false;
let flowPlayInterval = null;

function flowArg(d) {
  // Build the argument text for a FLOW event, e.g. "iter 4823", "CMD led 1".
  if (d.iter !== undefined) return "iter " + d.iter;
  if (d.cmd !== undefined)  return d.cmd;
  if (d.val !== undefined)  return d.val;
  if (d.led !== undefined)  return "led=" + d.led;
  return "";
}

// Entry point for each "FLOW;" line from the board.
function handleFlow(line) {
  const d = parseKv(line);
  d._time = new Date().toLocaleTimeString();

  if (el.flowStepMode.checked) {
    flowQueue.push(d);       // hold it — user steps through one at a time
    updateFlowStepButtons();
    return;
  }
  applyFlowEvent(d);
}

// Turn one parsed FLOW event into {kind, text} and render it.
function applyFlowEvent(d) {
  let kind, text;

  switch (d.evt) {
    case "loop":
      // Trace mode: the board is starting one real loop() pass.
      kind = "loop";
      text = `loop() — iteration ${d.iter !== undefined ? d.iter : "?"}`;
      setFlowActive("loop", `loop() — iteration ${d.iter !== undefined ? d.iter : "?"}`);
      break;
    case "enter":
      kind = "enter";
      text = `loop() → ${d.fn}(${flowArg(d)})`;
      setFlowActive(d.fn, `loop() → ${d.fn}()`);
      break;
    case "call":
      kind = "call";
      text = `loop() → ${d.fn}(${flowArg(d)})`;
      flashFlowNode(d.fn);
      break;
    case "exit":
      kind = "exit";
      text = `${d.fn}() returned → loop()`;
      setFlowActive("loop", "loop() — idle");
      break;
    default:
      kind = "other";
      text = "FLOW " + (d.evt || "") + " " + (d.fn || "");
  }
  addFlowRow(kind, text, d._time, d.evt);
}

// Which wire connects a called function to its caller in the block diagram.
const FLOW_WIRES = {
  updateBlink:  "loop-updateBlink",
  reportStatus: "loop-reportStatus",
  handleCommand:"loop-handleCommand",
  setLed:       "handleCommand-setLed",
  startBlink:   "handleCommand-startBlink",
  setInterval:  "handleCommand-setInterval",
  setTrace:     "handleCommand-setLed",     // reuse a visible command wire
  setPace:      "handleCommand-setInterval",
};

// Highlight the running function in the block diagram + breadcrumb + code.
function setFlowActive(fn, breadcrumbText) {
  resetFlowStage();
  flashFlowNode(fn);
  el.flowBreadcrumb.textContent = breadcrumbText;
}

function flashFlowNode(fn) {
  const node = el.blockDiagram.querySelector(`[data-fn="${fn}"]`);
  const wireKey = FLOW_WIRES[fn];
  const wire = wireKey
    ? el.blockDiagram.querySelector(`[data-wire="${wireKey}"]`)
    : null;

  if (node) node.classList.add("active");
  if (wire) wire.classList.add("active");
  highlightCodeFn(fn);
  el.flowBreadcrumb.textContent =
    fn === "loop" ? "loop() — idle" : `loop() → ${fn}()`;

  if (flowTimers[fn]) clearTimeout(flowTimers[fn]);
  // In step mode, hold the highlight until the next step (no auto-fade).
  if (el.flowStepMode.checked) return;
  flowTimers[fn] = setTimeout(() => {
    if (node) node.classList.remove("active");
    if (wire) wire.classList.remove("active");
    if (!el.blockDiagram.querySelector(".block.active")) {
      el.flowBreadcrumb.textContent = "loop() — idle";
      highlightCodeFn(null);
    }
  }, FLOW_ACTIVE_MS);
}

function resetFlowStage() {
  for (const fn in flowTimers) clearTimeout(flowTimers[fn]);
  el.blockDiagram.querySelectorAll(".block.active").forEach((n) =>
    n.classList.remove("active")
  );
  el.blockDiagram.querySelectorAll(".wire.active").forEach((n) =>
    n.classList.remove("active")
  );
  el.flowBreadcrumb.textContent = "loop() — idle";
  highlightCodeFn(null);
}

// Highlight the currently-running function in the code reference panel.
function highlightCodeFn(fn) {
  if (!el.codeContent) return;
  el.codeContent.querySelectorAll(".code-fn.running").forEach((n) =>
    n.classList.remove("running")
  );
  if (!fn) return;
  const span = el.codeContent.querySelector(`.code-fn[data-fn="${fn}"]`);
  if (span) {
    span.classList.add("running");
    // Keep the highlighted function in view while tracing (gentle scroll).
    span.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function addFlowRow(kind, text, time, evt) {
  const feed = el.flowFeed;
  const empty = feed.querySelector(".flow-empty");
  if (empty) empty.remove();
  el.flowClearBtn.disabled = false;

  const row = document.createElement("div");
  row.className = "flow-row flow-" + kind;
  row.innerHTML =
    `<span class="flow-time">${escapeHtml(time)}</span>` +
    `<span class="flow-text">${escapeHtml(text)}</span>`;
  // In step mode the feed reads top-to-bottom in execution order; live = newest on top.
  const newestOnTop = flowNewestOnTop && !el.flowStepMode.checked;
  if (newestOnTop) feed.prepend(row);
  else feed.appendChild(row);

  // Highlight the row that's executing right now.
  if (currentFlowRow) currentFlowRow.classList.remove("current");
  row.classList.add("current");
  currentFlowRow = row;
  if (!newestOnTop) feed.scrollTop = feed.scrollHeight;

  while (feed.children.length > FLOW_MAX_ROWS) {
    feed.removeChild(newestOnTop ? feed.lastChild : feed.firstChild);
  }
}

// ---- Step mode: run one queued event, or play through them at a set speed ----
function updateFlowStepButtons() {
  const pending = flowQueue.length - flowStepIndex;
  el.flowStepBtn.disabled = !el.flowStepMode.checked || pending <= 0 || flowPlaying;
  el.flowPlayBtn.disabled = !el.flowStepMode.checked || pending <= 0;
  el.flowPlayBtn.textContent = flowPlaying ? "Pause" : "Play";
  el.flowQueueInfo.textContent =
    el.flowStepMode.checked && flowQueue.length > 0
      ? `queued: ${pending} of ${flowQueue.length}`
      : "";
}

function flowStepOnce() {
  if (flowStepIndex < flowQueue.length) {
    applyFlowEvent(flowQueue[flowStepIndex]);
    flowStepIndex++;
    updateFlowStepButtons();
  }
}

function toggleFlowPlay() {
  if (!flowPlaying) {
    flowPlaying = true;
    const speed = parseInt(el.flowSpeed.value, 10) || 400;
    flowPlayInterval = setInterval(() => {
      if (flowStepIndex < flowQueue.length) {
        flowStepOnce();
      } else {
        stopFlowPlay();
      }
    }, speed);
  } else {
    stopFlowPlay();
  }
  updateFlowStepButtons();
}

function stopFlowPlay() {
  flowPlaying = false;
  if (flowPlayInterval) {
    clearInterval(flowPlayInterval);
    flowPlayInterval = null;
  }
  updateFlowStepButtons();
}

// Leaving step mode: flush whatever is still queued so nothing is lost.
function flushFlowQueue() {
  stopFlowPlay();
  while (flowStepIndex < flowQueue.length) {
    applyFlowEvent(flowQueue[flowStepIndex]);
    flowStepIndex++;
  }
  flowQueue = [];
  flowStepIndex = 0;
  updateFlowStepButtons();
}

function clearFlowFeed() {
  el.flowFeed.innerHTML =
    '<div class="flow-empty">Waiting for FLOW events from the board&hellip;</div>';
  el.flowClearBtn.disabled = true;
  currentFlowRow = null;
  flowQueue = [];
  flowStepIndex = 0;
  stopFlowPlay();
  updateFlowStepButtons();
  resetFlowStage();
}

// ---- Continuously read bytes and split into lines ----
async function readLoop() {
  const decoder = new TextDecoder();
  while (keepReading) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = lineBuffer.indexOf("\n")) >= 0) {
        const line = lineBuffer.slice(0, idx);
        lineBuffer = lineBuffer.slice(idx + 1);
        handleLine(line);
      }
    } catch (err) {
      log("read error: " + err.message);
      break;
    }
  }
}

// ---- Send a command line to the board ----
async function sendCommand(cmd) {
  if (!writer) return;
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(cmd + "\n"));
  log("sent: " + cmd);
}

// ---- Real-time trace (slows the BOARD, not the dashboard) ----
let traceOn = false;

async function setTrace(on) {
  traceOn = on;
  el.traceBtn.textContent = on ? "⏸ Stop trace" : "▶ Start real-time trace";
  el.traceBtn.classList.toggle("tracing", on);
  await sendCommand("CMD;trace=" + (on ? "on" : "off"));
  log(on
    ? `Trace ON: board running at ${el.tracePace.value} ms/loop, reporting every call in real time.`
    : "Trace OFF: board back to full speed.");
}

// ---- Connect / disconnect ----
async function connect() {
  if (!("serial" in navigator)) {
    log("Web Serial not supported. Use Chrome or Edge.");
    alert("This browser does not support Web Serial. Use Chrome or Edge.");
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 }); // 09_nonblocking_cloud.ino uses 9600

    writer = port.writable.getWriter();
    reader = port.readable.getReader();
    keepReading = true;

    setConnected(true);
    log("connected at 9600 baud");
    readLoop();
  } catch (err) {
    log("connect cancelled/failed: " + err.message);
  }
}

async function disconnect() {
  keepReading = false;
  try {
    if (reader) { await reader.cancel(); reader.releaseLock(); reader = null; }
    if (writer) { writer.releaseLock(); writer = null; }
    if (port)   { await port.close(); port = null; }
  } catch (err) {
    log("disconnect error: " + err.message);
  }
  setConnected(false);
  log("disconnected");
}

// ---- Wire up buttons ----
el.connectBtn.addEventListener("click", connect);
el.disconnectBtn.addEventListener("click", disconnect);
el.ledOnBtn.addEventListener("click", () => sendCommand("CMD;led=1"));
el.ledOffBtn.addEventListener("click", () => sendCommand("CMD;led=0"));
el.blinkBtn.addEventListener("click", () => {
  const n = parseInt(el.blinkCount.value, 10) || 1;
  sendCommand("CMD;blink=" + n);
});
el.intervalBtn.addEventListener("click", () => {
  let ms = parseInt(el.intervalMs.value, 10) || 500;
  ms = Math.max(50, Math.min(2000, ms)); // firmware accepts 50..2000
  el.intervalMs.value = ms;
  sendCommand("CMD;interval=" + ms);
});
el.clearLogBtn.addEventListener("click", () => (el.log.textContent = ""));

// ---- Live function flow controls ----
el.flowPause.addEventListener("change", () => {
  flowNewestOnTop = !el.flowPause.checked; // paused feed keeps reading order
  log(el.flowPause.checked ? "Flow feed paused." : "Flow feed resumed (newest first).");
});
el.flowClearBtn.addEventListener("click", clearFlowFeed);

// ---- Step-mode controls ----
el.flowStepMode.addEventListener("change", () => {
  if (el.flowStepMode.checked) {
    log("Step mode ON: function-flow events are queued. Click Step ▸ or Play.");
  } else {
    flushFlowQueue();
    log("Step mode OFF: queued events flushed, feed is live again.");
  }
  updateFlowStepButtons();
});
el.flowStepBtn.addEventListener("click", flowStepOnce);
el.flowPlayBtn.addEventListener("click", toggleFlowPlay);
el.flowSpeed.addEventListener("change", () => {
  // Restart the timer at the new speed if we're mid-play.
  if (flowPlaying) { stopFlowPlay(); toggleFlowPlay(); }
});

// ---- Real-time trace controls ----
el.traceBtn.addEventListener("click", () => setTrace(!traceOn));
el.tracePace.addEventListener("input", () => {
  el.tracePaceVal.textContent = el.tracePace.value + " ms/loop";
});
el.tracePace.addEventListener("change", () => {
  // Send the new pace to the board (applies live, even mid-trace).
  el.tracePaceVal.textContent = el.tracePace.value + " ms/loop";
  sendCommand("CMD;pace=" + el.tracePace.value);
});

// Tidy up if the page closes while connected.
window.addEventListener("beforeunload", () => { if (port) disconnect(); });

// Start disabled until connected.
setConnected(false);
updateFlowStepButtons();
log("Ready. Connect your Arduino Uno R3 running 09_nonblocking_cloud.ino.");
