# Student Quick-Start

Welcome! You'll learn C++ **functions** by making a microcontroller blink,
sense, and report — and watching it all live in a browser dashboard.

## 1. Install the Arduino IDE
- Download from arduino.cc and install.
- Plug in your board with the USB cable.
- In the IDE: **Tools -> Board** (pick your board) and **Tools -> Port**
  (pick the port that appears when the board is plugged in).

## 2. Run your first sketch
1. Open `examples/01_function_basics.ino`.
2. Click the **Upload** arrow (top-left).
3. After "Done uploading", open **Tools -> Serial Monitor** and set it to
   **9600 baud**. You'll see messages each time a function is called.

## 3. Work through the examples (read the comments!)
| File                                | You'll learn               |
|-------------------------------------|----------------------------|
| `examples/01_function_basics.ino`   | what a function is         |
| `examples/02_parameters.ino`        | passing inputs in          |
| `examples/03_return_values.ino`     | getting outputs back       |
| `examples/04_overloading.ino`       | same name, different inputs|
| `examples/05_status_reporter.ino`   | functions that report state|

## 4. Use the dashboard (the fun part)
1. Upload `examples/05_status_reporter.ino`.
2. **Close the Serial Monitor** (only one app can use the port).
3. Open `dashboard/index.html` in **Chrome or Edge**.
4. Click **Connect**, choose your board's port.
5. Watch uptime, LED, blink count, and sensor update live. Click the buttons to
   call functions on the board.

> **First connect — what to expect:** clicking **Connect** opens a small browser
> popup listing serial ports. Pick your board (e.g. an entry like "CP2102",
> "CH340", or "USB Serial") and click Connect. This popup appears **every
> session** — it's a browser security rule, not a bug. If the list is empty,
> your USB driver isn't installed or the Serial Monitor is still holding the
> port. If you opened the dashboard from a web link (URL), this all works the
> same — the link is only the UI; your board must still be plugged into *your*
> computer with the firmware already uploaded.

## 5. Do the labs
Open the `labs/` folder and complete `lab1` through `lab5` in order. Each tells
you exactly what to build and how you'll be graded.

## Stuck?
- **Won't upload:** check Board + Port under Tools; replug the cable.
- **Serial Monitor blank:** set baud to 9600.
- **Dashboard won't connect:** use Chrome/Edge, and close the Serial Monitor.
- Read the comments at the bottom of each example — they have hints.

You've got this. Every function you write makes something physical happen —
that's the best kind of feedback.
