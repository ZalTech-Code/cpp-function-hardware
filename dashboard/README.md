# Browser Dashboard (Web Serial)

A zero-install dashboard that connects to the board over USB and shows its state
live. It pairs with `examples/05_status_reporter.ino` (and Lab 5).

> Sharing this with a class? See `docs/distribution.md` for how to distribute the
> dashboard to multiple students (zip it, or host it once with a shared link).

## Requirements
- **Chrome or Edge** (desktop). The Web Serial API is not in Safari/Firefox.
- The board must already be running a sketch that prints `STATUS;...` lines at
  **9600 baud** (use example 05 or your Lab 5 sketch).
- Close the Arduino IDE's Serial Monitor first — only one program can hold the
  port at a time.

## Run it
1. Upload `examples/05_status_reporter.ino` to the board (set your board in
   `examples/board_config.h` first).
2. Open `dashboard/index.html` in Chrome/Edge (double-click the file).
3. Click **Connect**, choose your board's serial port in the popup.
4. The **Board** dropdown **auto-selects** to match the firmware: on startup the
   board sends a `BOARD;name=...;adcmax=...` line and the dashboard picks the
   right profile (gauge scaling + sensor label). You can still override it
   manually if needed.
5. Watch the cards update; click the control buttons to drive the board.

> Auto-detect needs the board to send the `BOARD;` line, which example 05 (and a
> correct Lab 5) prints in `setup()`. If you connect *after* the board already
> booted, press the board's reset button so it re-announces — or just pick the
> board in the dropdown yourself.

## What you'll see
- **LED** — lights up yellow when the board's LED is on.
- **Uptime** — seconds since the board booted (`millis()`).
- **Total Blinks** — counter the firmware increments on each blink.
- **Sensor** — live analog reading with a gauge bar (label/scale match the
  selected board: GPIO 34 on ESP32, A0 on Uno, pin 0 on micro:bit).
- **Serial Log** — raw lines, useful for debugging your own STATUS format.

## Controls (browser -> board)
| Button        | Command sent  | Firmware function |
|---------------|---------------|-------------------|
| LED On        | `CMD;led=1`   | `setLed(1)`       |
| LED Off       | `CMD;led=0`   | `setLed(0)`       |
| Run blink     | `CMD;blink=N` | `doBlink(N)`      |

## The protocol (so students can extend it)
```
Board -> browser:  STATUS;uptime=<ms>;led=<0|1>;blinks=<n>;sensor=<0..ADC_MAX>
Browser -> board:  CMD;blink=<n>     CMD;led=<0|1>
```
To add a field, print it in the firmware's `reportStatus()` and read it in
`updateUI()` inside `dashboard.js`. To add a command, send it from a button and
handle it in the firmware's `handleCommand()`.

## Troubleshooting
- **No port in the list:** install your board's USB driver (e.g. CH340/CP210x),
  replug the cable, try a different USB port.
- **"Web Serial not supported":** you're not in Chrome/Edge.
- **Connected but no updates:** the Serial Monitor is probably still open, or the
  baud rate isn't 9600, or the sketch isn't printing `STATUS;` lines.
- **Garbled text:** baud mismatch — both sides must be 9600.
