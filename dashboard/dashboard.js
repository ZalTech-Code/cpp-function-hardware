// dashboard.js — Web Serial bridge between the browser and the microcontroller.
//
// Reads STATUS lines from the board and updates the UI, and sends CMD lines
// when the user clicks a control. See examples/05_status_reporter.ino for the
// matching firmware protocol.
//
// PROTOCOL
//   Board -> browser:  STATUS;uptime=<ms>;led=<0|1>;blinks=<n>;sensor=<0..4095>
//   Browser -> board:  CMD;blink=<n>   or   CMD;led=<0|1>

"use strict";

// ---- Element references ----
const el = {
  connectBtn:    document.getElementById("connect-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  statusDot:     document.getElementById("status-dot"),
  statusText:    document.getElementById("status-text"),
  ledIndicator:  document.getElementById("led-indicator"),
  ledValue:      document.getElementById("led-value"),
  uptimeValue:   document.getElementById("uptime-value"),
  blinksValue:   document.getElementById("blinks-value"),
  sensorValue:   document.getElementById("sensor-value"),
  sensorBar:     document.getElementById("sensor-bar"),
  sensorGraph:   document.getElementById("sensor-graph"),
  ledOnBtn:      document.getElementById("led-on-btn"),
  ledOffBtn:     document.getElementById("led-off-btn"),
  blinkCount:    document.getElementById("blink-count"),
  blinkBtn:      document.getElementById("blink-btn"),
  boardSelect:   document.getElementById("board-select"),
  log:           document.getElementById("log"),
  clearLogBtn:   document.getElementById("clear-log-btn"),
  watchFn:       document.getElementById("watch-fn"),
  watchN:        document.getElementById("watch-n"),
  watchRunBtn:   document.getElementById("watch-run-btn"),
  watchClearBtn: document.getElementById("watch-clear-btn"),
  watchExportBtn: document.getElementById("watch-export-btn"),
  watchStepBtn:  document.getElementById("watch-step-btn"),
  watchPlayBtn:  document.getElementById("watch-play-btn"),
  watchStepMode: document.getElementById("watch-step-mode"),
  watchQueueInfo: document.getElementById("watch-queue-info"),
  watchStack:    document.getElementById("watch-stack"),
  watchResult:   document.getElementById("watch-result"),
  watchMem:      document.getElementById("watch-mem"),
  flowFeed:      document.getElementById("flow-feed"),
  flowPause:     document.getElementById("flow-pause"),
  flowClearBtn:  document.getElementById("flow-clear-btn"),
};

// ---- Board profiles (must match examples/board_config.h) ----
const BOARDS = {
  esp32:    { name: "ESP32",          adcMax: 4095, sensorLabel: "Sensor (GPIO 34)" },
  uno:      { name: "Arduino Uno R3", adcMax: 1023, sensorLabel: "Sensor (A0)" },
  microbit: { name: "micro:bit v2",   adcMax: 1023, sensorLabel: "Sensor (pin 0)" },
};
// Currently selected board profile; defaults to the dropdown's first option.
let board = BOARDS.esp32;

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
  const div = document.createElement('div');
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
  [el.ledOnBtn, el.ledOffBtn, el.blinkBtn, el.watchRunBtn, el.watchClearBtn, el.watchStepBtn, el.watchPlayBtn, el.watchExportBtn].forEach(b => (b.disabled = !connected));
  el.flowClearBtn.disabled = !connected || !el.flowFeed.querySelector(".flow-row");
}

// ---- Parse one STATUS line into a key/value object ----
function parseStatus(line) {
  // line: "STATUS;uptime=1234;led=1;blinks=7;sensor=512"
  const parts = line.split(";");
  if (parts[0] !== "STATUS") return null;
  const data = {};
  for (let i = 1; i < parts.length; i++) {
    const [key, value] = parts[i].split("=");
    if (key) data[key] = value;
  }
  return data;
}

// ---- Update the dashboard cards from parsed data ----
function updateUI(data) {
  if ("led" in data) {
    const on = data.led === "1";
    el.ledIndicator.classList.toggle("on", on);
    el.ledIndicator.classList.toggle("off", !on);
    el.ledValue.textContent = on ? "ON" : "OFF";
  }
  if ("uptime" in data) {
    const secs = (Number(data.uptime) / 1000).toFixed(1);
    el.uptimeValue.textContent = secs;
  }
  if ("blinks" in data) {
    el.blinksValue.textContent = data.blinks;
  }
  if ("sensor" in data) {
    const v = Number(data.sensor);
    el.sensorValue.textContent = v;
    // Scale against the selected board's ADC max (4095 ESP32, 1023 Uno/micro:bit).
    const pct = Math.max(0, Math.min(100, (v / board.adcMax) * 100));
    el.sensorBar.style.width = pct + "%";
    // Push to history and redraw graph
    sensorHistory.values.push(v);
    if (sensorHistory.values.length > sensorHistory.maxPoints) {
      sensorHistory.values.shift();
    }
    drawSensorGraph();
  }
}

// ---- Handle a full line received from the board ----
function handleLine(line) {
  line = line.trim();
  if (!line) return;

  // The firmware announces its board once on startup: "BOARD;name=...;adcmax=..."
  if (line.startsWith("BOARD;")) {
    autoSelectBoard(line);
    return;
  }

  // Live function-flow events: "FLOW;evt=...;fn=...;..."
  if (line.startsWith("FLOW;")) {
    handleFlow(line);
    return;
  }

  // Variable & call-stack watch events: "WATCH;evt=...;..."
  if (line.startsWith("WATCH;")) {
    handleWatch(line);
    return;
  }

  const data = parseStatus(line);
  if (data) {
    updateUI(data);
  } else {
    log("board: " + line); // non-status output (e.g. debug prints)
  }
}

// ---- Variable & call-stack watch state ----
// Each frame: { fn, depth, vars: [{name, val, isArg}] }
let watchStack = [];

// Step-play mode for WATCH events
let watchQueue = [];
let watchStepIndex = 0;
let watchPlaying = false;
let watchPlayInterval = null;
const WATCH_STEP_INTERVAL_MS = 200;

// Watch log for export
let watchLog = [];

// Sensor history for live graph
let sensorHistory = { values: [], maxPoints: 60 };

// Parse a "WATCH;k=v;k=v" line into an object.
function parseKv(line) {
  const data = {};
  for (const part of line.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) data[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return data;
}

// Handle one WATCH event and update the call-stack view.
function handleWatch(line) {
  const d = parseKv(line);
  watchLog.push({ time: Date.now(), line: line });
  if (el.watchStepMode.checked) {
    watchQueue.push(d);
    updateStepPlayButtons();
    return;
  }
  applyWatchEvent(d);
}

// Apply a watch event to the UI (the original logic, now extracted).
function applyWatchEvent(d) {
  switch (d.evt) {
    case "run":
      watchStack = [];
      el.watchResult.textContent = "running " + d.name + "(" + d.n + ")...";
      renderWatch();
      break;
    case "enter":
      watchStack.push({ fn: d.fn, depth: Number(d.depth), vars: [], returning: false });
      renderWatch();
      break;
    case "arg":
      addWatchVar(d.fn, d.name, d.val, true);
      break;
    case "var":
      addWatchVar(d.fn, d.name, d.val, false);
      break;
    case "exit":
      if (watchStack.length) {
        const frame = watchStack[watchStack.length - 1];
        frame.returning = true;
        if (d.ret !== undefined) frame.returnValue = d.ret;
      }
      renderWatch();
      watchStack.pop();
      renderWatch();
      break;
    case "mem":
      el.watchMem.textContent = "free RAM: " + d.free + " B";
      break;
    case "result":
      el.watchResult.textContent = d.name + " = " + d.val;
      break;
    case "error":
      el.watchResult.textContent = "error: " + (d.msg || "unknown");
      break;
    default:
      log("watch: " + line);
  }
}

// Add/update a variable on the matching (top-most) frame for fn.
function addWatchVar(fn, name, val, isArg) {
  for (let i = watchStack.length - 1; i >= 0; i--) {
    if (watchStack[i].fn === fn) {
      const existing = watchStack[i].vars.find(v => v.name === name);
      if (existing) existing.val = val;
      else watchStack[i].vars.push({ name, val, isArg });
      renderWatch();
      return;
    }
  }
}

// Draw the call stack (deepest frame on top).
function renderWatch() {
  if (!watchStack.length) {
    el.watchStack.innerHTML =
      '<div class="watch-empty">Stack is empty. Click "Run with watch".</div>';
    return;
  }
  let html = "";
  // Show deepest (last) frame first so the stack reads top-down.
  for (let i = watchStack.length - 1; i >= 0; i--) {
    const f = watchStack[i];
    html += '<div class="watch-frame' + (f.returning ? " returning" : "") + '">';
    html += '<span class="watch-fn-name">' + escapeHtml(f.fn) + "()</span>";
    html += '<span class="watch-depth">depth ' + f.depth + "</span>";
    for (const v of f.vars) {
      html += '<div class="watch-var' + (v.isArg ? " is-arg" : "") + '">' +
              '<span class="vname">' + escapeHtml(v.name) + '</span> = ' +
              '<span class="vval">' + escapeHtml(v.val) + "</span></div>";
    }
    if (f.returnValue !== undefined) {
      html += '<div class="watch-var is-return">return = <span class="vval">' + escapeHtml(f.returnValue) + '</span></div>';
    }
    html += "</div>";
  }
  el.watchStack.innerHTML = html;
}

// ---- Step-play control for WATCH events ----
function updateStepPlayButtons() {
  const hasUnapplied = watchQueue.length > watchStepIndex;
  el.watchStepBtn.disabled = !hasUnapplied || watchPlaying;
  el.watchPlayBtn.disabled = !hasUnapplied;
  el.watchPlayBtn.textContent = watchPlaying ? "Pause" : "Play";
  const info = el.watchQueueInfo;
  if (watchQueue.length > 0) {
    info.textContent = `queued: ${watchQueue.length - watchStepIndex} of ${watchQueue.length}`;
  } else {
    info.textContent = "";
  }
}

function exitStepMode() {
  while (watchStepIndex < watchQueue.length) {
    applyWatchEvent(watchQueue[watchStepIndex]);
    watchStepIndex++;
  }
  watchQueue = [];
  watchStepIndex = 0;
  watchPlaying = false;
  if (watchPlayInterval) {
    clearInterval(watchPlayInterval);
    watchPlayInterval = null;
  }
  updateStepPlayButtons();
}

function toggleWatchPlay() {
  if (!watchPlaying) {
    watchPlaying = true;
    watchPlayInterval = setInterval(() => {
      if (watchStepIndex < watchQueue.length) {
        applyWatchEvent(watchQueue[watchStepIndex]);
        watchStepIndex++;
        updateStepPlayButtons();
      } else {
        clearInterval(watchPlayInterval);
        watchPlaying = false;
        watchPlayInterval = null;
        updateStepPlayButtons();
      }
    }, WATCH_STEP_INTERVAL_MS);
  } else {
    clearInterval(watchPlayInterval);
    watchPlayInterval = null;
    watchPlaying = false;
  }
  updateStepPlayButtons();
}

// ---- Sensor history graph ----
// (drawSensorGraph defined below)

// ---- Live function flow ----
// Renders "loop() -> fn()" transitions streamed as FLOW; lines by the firmware.
const FLOW_MAX_ROWS = 60;            // keep the DOM small
let flowNewestOnTop = true;

function parseFlowKv(line) {
  const data = {};
  for (const part of line.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) data[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return data;
}

function handleFlow(line) {
  const d = parseFlowKv(line);
  const t = new Date().toLocaleTimeString();
  let kind, text;

  switch (d.evt) {
    case "enter":
      kind = "enter";
      text = `loop() → ${d.fn}(` +
             (d.iter !== undefined ? `iter ${d.iter}` :
              d.cmd !== undefined ? `${d.cmd}` : "") + ")";
      break;
    case "call":
      kind = "call";
      text = `loop() → ${d.fn}(${d.val !== undefined ? d.val : d.led !== undefined ? "led=" + d.led : ""})`;
      break;
    case "exit":
      kind = "exit";
      text = `${d.fn}() returned → loop()`;
      break;
    default:
      kind = "other";
      text = line;
  }
  addFlowRow(kind, text, t);
}

function addFlowRow(kind, text, time) {
  const feed = el.flowFeed;
  const empty = feed.querySelector(".flow-empty");
  if (empty) empty.remove();
  el.flowClearBtn.disabled = false;

  const row = document.createElement("div");
  row.className = "flow-row flow-" + kind;
  row.innerHTML =
    `<span class="flow-time">${escapeHtml(time)}</span>` +
    `<span class="flow-text">${escapeHtml(text)}</span>`;
  if (flowNewestOnTop) feed.prepend(row);
  else feed.appendChild(row);

  while (feed.children.length > FLOW_MAX_ROWS) {
    feed.removeChild(flowNewestOnTop ? feed.lastChild : feed.firstChild);
  }
}

function clearFlowFeed() {
  el.flowFeed.innerHTML = '<div class="flow-empty">Waiting for FLOW events from the board&hellip;</div>';
  el.flowClearBtn.disabled = true;
}

// ---- Sensor history graph ----
function drawSensorGraph() {
  const canvas = el.sensorGraph;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const values = sensorHistory.values;
  if (values.length < 2) {
    ctx.fillStyle = "#8b98a5";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("wait...", w / 2, h / 2);
    return;
  }
  let min = 0;
  let max = Math.max(...values);
  if (max === min) max = min + 1;
  max = max * 1.05; // headroom
  ctx.beginPath();
  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * w;
    const normalized = (values[i] - min) / (max - min);
    const y = h - (normalized * h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ---- Watch log export ----
function exportWatchLog() {
  if (watchLog.length === 0) {
    alert("No watch log to export.");
    return;
  }
  const data = JSON.stringify({
    board: board.name,
    exportedAt: new Date().toISOString(),
    events: watchLog
  }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "watch-log-" + Date.now() + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Match a "BOARD;name=...;adcmax=..." line to a dropdown profile and select it.
function autoSelectBoard(line) {
  const parts = line.split(";");
  let name = null, adcmax = null;
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (k === "name") name = v;
    if (k === "adcmax") adcmax = Number(v);
  }
  // Prefer matching on the firmware's name (distinguishes Uno from micro:bit,
  // which share the same 10-bit ADC). Fall back to adcMax if the name is
  // unrecognized, so a custom board still gets sensible gauge scaling.
  let key = name
    ? Object.keys(BOARDS).find(k => BOARDS[k].name === name)
    : null;
  if (!key && adcmax !== null) {
    key = Object.keys(BOARDS).find(k => BOARDS[k].adcMax === adcmax);
  }
  if (key) {
    el.boardSelect.value = key;
    applyBoard(key);
    log("auto-detected board from firmware (" + line.slice(6) + ")");
  } else {
    log("firmware announced unknown board: " + line.slice(6));
  }
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

// ---- Connect / disconnect ----
async function connect() {
  if (!("serial" in navigator)) {
    log("Web Serial not supported. Use Chrome or Edge.");
    alert("This browser does not support Web Serial. Use Chrome or Edge.");
    return;
  }
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });

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
    if (port) { await port.close(); port = null; }
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
el.clearLogBtn.addEventListener("click", () => (el.log.textContent = ""));

// ---- Variable & call-stack watch buttons ----
el.watchRunBtn.addEventListener("click", () => {
  const fn = el.watchFn.value;
  const n = parseInt(el.watchN.value, 10) || 0;
  // If step mode active, reset step queue
  if (el.watchStepMode.checked) {
    watchQueue = [];
    watchStepIndex = 0;
    watchPlaying = false;
    if (watchPlayInterval) { clearInterval(watchPlayInterval); watchPlayInterval = null; }
  }
  sendCommand("CMD;run=" + fn + ";n=" + n);
});
el.watchClearBtn.addEventListener("click", () => {
  watchStack = [];
  watchQueue = [];
  watchStepIndex = 0;
  watchPlaying = false;
  if (watchPlayInterval) { clearInterval(watchPlayInterval); watchPlayInterval = null; }
  el.watchResult.textContent = "—";
  el.watchMem.textContent = "";
  renderWatch();
  updateStepPlayButtons();
});

// ---- Step-play & export controls ----
el.watchExportBtn.addEventListener("click", exportWatchLog);
el.watchStepBtn.addEventListener("click", () => {
  if (watchStepIndex < watchQueue.length) {
    applyWatchEvent(watchQueue[watchStepIndex]);
    watchStepIndex++;
    updateStepPlayButtons();
  }
});
el.watchPlayBtn.addEventListener("click", toggleWatchPlay);
el.watchStepMode.addEventListener("change", () => {
  if (el.watchStepMode.checked) {
    log("Step mode enabled: watch events will be queued for stepping.");
  } else {
    exitStepMode();
    log("Step mode disabled: remaining events flushed.");
  }
});

// ---- Live function flow controls ----
el.flowPause.addEventListener("change", () => {
  flowNewestOnTop = false; // paused feed keeps history in reading order
  log(el.flowPause.checked ? "Flow feed paused." : "Flow feed resumed (newest first).");
});
el.flowClearBtn.addEventListener("click", clearFlowFeed);

// ---- Board selector ----
// Switches the ADC scaling + sensor label to match the selected board.
function applyBoard(key) {
  board = BOARDS[key] || BOARDS.esp32;
  const sensorLabel = document.querySelector("#sensor-value")
    .closest(".card").querySelector(".card-label");
  if (sensorLabel) sensorLabel.textContent = board.sensorLabel;
  log("board set to " + board.name + " (ADC max " + board.adcMax + ")");
}
el.boardSelect.addEventListener("change", (e) => applyBoard(e.target.value));

// Tidy up if the page closes while connected.
window.addEventListener("beforeunload", () => { if (port) disconnect(); });

// Start disabled until connected.
setConnected(false);
applyBoard(el.boardSelect.value);   // initialize label/ADC from the dropdown
updateStepPlayButtons();            // ensure step/play buttons start disabled
log("Ready. Pick your board, click Connect, and choose its serial port.");
