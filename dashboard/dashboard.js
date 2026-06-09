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
  ledOnBtn:      document.getElementById("led-on-btn"),
  ledOffBtn:     document.getElementById("led-off-btn"),
  blinkCount:    document.getElementById("blink-count"),
  blinkBtn:      document.getElementById("blink-btn"),
  boardSelect:   document.getElementById("board-select"),
  log:           document.getElementById("log"),
  clearLogBtn:   document.getElementById("clear-log-btn"),
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

// ---- UI: reflect connection status ----
function setConnected(connected) {
  el.statusDot.classList.toggle("on", connected);
  el.statusDot.classList.toggle("off", !connected);
  el.statusText.textContent = connected ? "Connected" : "Disconnected";
  el.connectBtn.disabled = connected;
  el.disconnectBtn.disabled = !connected;
  [el.ledOnBtn, el.ledOffBtn, el.blinkBtn].forEach(b => (b.disabled = !connected));
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

  const data = parseStatus(line);
  if (data) {
    updateUI(data);
  } else {
    log("board: " + line); // non-status output (e.g. debug prints)
  }
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
log("Ready. Pick your board, click Connect, and choose its serial port.");
