# Teaching C++ Functions with Hardware

A teaching pack for an **intermediate** class learning C++ **functions** using a
microcontroller (Arduino-compatible). Students don't just read about functions —
they *see* each call happen on real hardware and watch the board's state live in
a browser dashboard.

## Why this works
Every C++ function concept is mapped to a physical, observable action:

| C++ concept            | Hardware action                              |
|------------------------|----------------------------------------------|
| `void` function, no args | Blink the onboard LED once                 |
| Function with a parameter | `blink(int times)` controls how many blinks |
| Multiple parameters    | `blink(int times, int speed)`                |
| Return value           | `int readSensor()` returns a value you use   |
| Function overloading   | `setLed(bool)` vs `setLed(int brightness)`   |
| Calling functions      | A menu drives which function runs            |

Because results are visible (LED, timing) and the board streams its state over
Serial, students get instant feedback on what their function call actually did.

## What's inside

```
examples/    Annotated, runnable sketches (read these first)
labs/        Graded exercises with rubrics (students do these)
dashboard/   Browser dashboard to monitor the board live (Web Serial)
docs/        Cheat sheet + student quick-start
```

## Hardware (choose your board)
The examples work on **three boards**. You pick one in
`examples/board_config.h` (uncomment a single `#define BOARD_*` line) and every
sketch automatically uses the right pins and ADC range. No wiring is required to
start — each board's onboard LED is enough.

| Board            | Onboard LED | Analog pin | ADC range |
|------------------|-------------|------------|-----------|
| ESP32 dev board  | GPIO 2      | GPIO 34    | 0–4095 (12-bit) |
| Arduino Uno R3   | pin 13      | A0         | 0–1023 (10-bit) |
| micro:bit v2     | `LED_BUILTIN` | pin 0    | 0–1023 (10-bit) |

You'll need:
- One of the boards above + a USB cable
- ESP32 only: the CP210x/CH340 USB driver if your OS doesn't auto-install it
- (Optional) potentiometer or LDR on the analog pin, external LED + 220Ω resistor, pushbutton

> The dashboard has a matching **Board** dropdown — pick the same board there so
> the sensor gauge scales correctly. If your board's onboard LED is on a
> different pin than the table above, change it in `examples/board_config.h`.

## How to run
1. Open any sketch in `examples/` with the Arduino IDE.
2. Select your board + port, click **Upload**.
3. Open **Serial Monitor** at **9600 baud** to read the printed output, OR
4. Open `dashboard/index.html` in Chrome/Edge and click **Connect** to watch
   the board state live (see `dashboard/README.md`).

## Suggested teaching order
1. `examples/01_function_basics.ino` — what a function is
2. `examples/02_parameters.ino` — passing data in
3. `examples/03_return_values.ino` — getting data out
4. `examples/04_overloading.ino` — same name, different signatures
5. `examples/05_status_reporter.ino` — functions that report state (feeds the dashboard)
6. Then assign `labs/` in order.

## License
This project uses two licenses for its two kinds of content:

- **Code** (`examples/`, `dashboard/`) — **MIT License**. See `LICENSE`.
- **Educational content** (`labs/`, `docs/`, README prose) — **Creative Commons
  Attribution 4.0 (CC BY 4.0)**. See `LICENSE-docs.md`.

In short: free to use, adapt, and share for classroom teaching (and beyond).
Reusing the lesson materials just requires crediting the author. Before
publishing, replace `[YOUR NAME]` in both license files with the author's name.
