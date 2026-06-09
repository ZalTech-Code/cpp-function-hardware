# C++ Functions Cheat Sheet (Hardware Edition)

Quick reference. Each concept is paired with what it does on the board.

## Anatomy of a function
```cpp
int blink(int times, int speed) {   // <- signature
//  ^      ^                        return type, name
//         ^^^^^^^^^^^^^^^^^^^      parameters (inputs)
  // ... body: the work happens here ...
  return times;                     // <- return value (output)
}
```

## Declaration vs definition
```cpp
void blink(int times);   // DECLARATION (prototype) - goes ABOVE setup()
                         // tells the compiler the function exists

void blink(int times) {  // DEFINITION - the actual code
  // ...
}
```
Put declarations above `setup()` so you can define the bodies later in the file.

## Parameters vs arguments
```cpp
void blink(int times) { ... }   // `times` is a PARAMETER
blink(3);                       // `3` is an ARGUMENT
```

## void vs return value
```cpp
void ledOn() { digitalWrite(LED, HIGH); }   // returns nothing
int  readSensor() { return analogRead(SENSOR_PIN); } // returns 0..ADC_MAX

int value = readSensor();   // capture the returned value
```

## Calling a function
```cpp
pulse();          // no arguments
blink(5);         // one argument
blink(5, 100);    // two arguments
```

## Overloading (same name, different parameters)
```cpp
void setLed(bool on);            // setLed(true)
void setLed(int blinks);         // setLed(3)
void setLed(int blinks, int s);  // setLed(3, 100)
```
The compiler picks the version that matches your arguments.
You **cannot** overload by return type alone.

## Common hardware calls used in these labs
| Call                         | Meaning                              |
|------------------------------|--------------------------------------|
| `pinMode(pin, OUTPUT)`       | set a pin to drive output            |
| `digitalWrite(pin, HIGH/LOW)`| turn a pin on/off                    |
| `analogRead(SENSOR_PIN)`     | read 0..ADC_MAX from an analog pin   |
| `delay(ms)`                  | pause for milliseconds               |
| `millis()`                   | ms since boot (great for uptime)     |
| `map(v, 0,ADC_MAX, lo,hi)`   | rescale a number to a new range      |
| `Serial.begin(9600)`         | start serial output                  |
| `Serial.println(x)`          | print a line                         |

## Good function habits
- One function = one job. Name it after that job (`readSensor`, not `doStuff`).
- If you copy-paste code, that's a sign it should be a function.
- Keep "logic" functions (math/decisions) separate from "hardware" functions
  (`digitalWrite`). Logic functions are easy to test.
