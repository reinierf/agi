# Addendum to CLAUDE.md: NAGI as the reference implementation

*Added 2026-11-19. This adds to the handover in CLAUDE.md and doesn't replace it. Where this file and CLAUDE.md disagree on how AGI behaves, this file wins, because its facts were checked in NAGI's source.*

## What NAGI is and how to use it

- **NAGI** (New Adventure Game Interpreter) by Nick Sonneveld is a C/SDL2 AGI interpreter written by **disassembling Sierra's original interpreter**. Many source files start with a comment listing the original function names and code-segment addresses. Treat it as the most faithful readable description of how AGI actually behaves. It is more reliable than the written specs, and more reliable than jsyang's code.
- Source: https://github.com/sonneveld/nagi (full history from 2000; includes the 2002 public release plus later Linux, macOS and SDL2 fixes).
- Clone it **outside this repo**, or into a git-ignored `reference/nagi/` folder. Don't vendor it.
- It supports AGI v2 and v3 (`res/res_lzw.c`, `version/`), so it's also the starting point if v3 support ever comes into scope.

**Reference order when behaviour is unclear:**
1. NAGI source
2. ScummVM's AGI engine (as a cross-check, and for running games side by side)
3. The AGI specifications (ScummVM wiki / AGIWiki)

## License rules for porting

NAGI uses the **X11 license** (permissive, MIT-style), which is compatible with this project's GPL-3. Porting NAGI logic into JS is allowed, under these conditions:

- Copy NAGI's `license.txt` to `licenses/NAGI-LICENSE.txt` in this repo.
- In every JS file containing code ported from NAGI, add a header comment like this: `Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt`. Also name the NAGI source file each piece came from.
- Mention NAGI in the README credits. Don't use Nick Sonneveld's name to endorse or promote the project.

**Porting style:** translate behaviour and control flow faithfully, but write idiomatic JS. Don't reproduce C pointer arithmetic where an index or array does the same job. Keep the original function names from NAGI's header comments in a comment above each ported function, so it can be traced back.

## Where things live: NAGI → jsyang

| Area | NAGI (`src/…`) | jsyang (`src/…`) |
|---|---|---|
| Main cycle | `nagi_main.c` (main loop) | `interpreter.js` → `cycle()`, `handleInput()` |
| Logic execution | `logic/logic_execute.c`, `logic/logic_base.c` | `logic.js` → `parseLogic()` |
| Command table (names, **argument counts**) | `logic/cmd_table.c` | `constants.js` (names), argument count taken from the JS function's parameter count |
| Condition tests (incl. `said`) | `logic/logic_eval.c` | `logicCommands.js` (`agi_test_*`) |
| Parser / WORDS.TOK lookup | `ui/parse.c` | `resources.js` → `extractWords()`; no parser yet |
| Input line | `ui/cmd_input.c`, `ui/events.c` | `interpreter.js` → `handleInput()` (partial) |
| Message windows (`print`, `close.window`) | `ui/msg.c`, `ui/window.c`, `ui/agi_text.c` | `logicCommands.js`, `screen.js` |
| `get.string` / `get.num` | `ui/string.c` | `logicCommands.js` |
| Menus | `ui/menu.c` | `logicCommands.js`, `index.html` |
| Status line | `ui/status.c` | `interpreter.js` → `updateScore()` (HTML, not drawn in-game) |
| `new.room` | `new_room.c` | `logicCommands.js` → `agi_new_room` |
| Objects, motion, priority, drawing | `view/obj_*.c` | `interpreter.js` → `updateObject()`, `gameObject.js`, `view.js` |
| Pictures | `res/res_pic.c`, `picture/` | `bitmap.js` |
| Inventory | `objects.c`, `obj_show.c` | `logicCommands.js` |
| Save / restore | `state_io.c`, `state_info.c` | `persist.js`, `playerSaveSystem.js` |
| Game detection / version quirks | `version/agi_crc.c`, `version/standard.c` | none |
| Sound | `sound/` | `sound.js`, `soundEmulator.js` |

## Checked facts (replace the "verify" items in CLAUDE.md, Phase 2)

From `ui/parse.c`, `logic/logic_eval.c` (`cmd_said`), `nagi_main.c`, `ui/msg.c` and `agi.h`:

**Parsing (`parse()` / `parse_read()` / `word_find()`)**
- Separator characters: `` ,.?!();:[]{}`` and space. They end a word. Several in a row count as one.
- Characters removed entirely: `` ' ` - " ``.
- The parse buffer is 42 characters. **At most 10 words** are stored (`WORD_BUF_SIZE`).
- A single-letter word `a` or `i` is skipped automatically (treated as filler).
- A word that doesn't start with a–z is never found, so it counts as unknown.
- Dictionary lookup uses the WORDS.TOK first-letter index, then finds the **longest match**. Entries can contain spaces. Characters in WORDS.TOK are XOR 0x7F, and the high bit marks the last character of an entry. The word-group number (2 bytes, big-endian) follows that last character.
- Word group **0** is filler and is skipped without being stored.
- **Unknown word:** store it, set **v9 = (number of words stored so far) + 1** (1-based), and stop parsing.
- If at least one word was stored (including the unknown one), set **flag 2**.
- The `parse(strNo)` command first resets flags 2 and 4, then parses `string[strNo]`, but only for string numbers below 12.

**`said()` (`cmd_said`)**
- It only tries to match if there are stored words, **flag 4 is clear and flag 2 is set**. If not, it returns false (and still skips its argument bytes).
- Word groups are compared in order. Group **1** matches any single word. Group **9999** matches the rest of the line, however long, and ends the comparison successfully.
- The number of words must match exactly: no extra or missing player words, unless 9999 is used.
- On a match: **set flag 4** and return true. Because flag 4 is now set, every later `said()` in the same cycle returns false.
- `said`'s arguments in the bytecode are a count byte followed by 2-byte **little-endian** word-group numbers.

**Start of each cycle (`nagi_main.c`)**, in this order:
1. Clear controllers, reset flag 2, reset flag 4, set v19 (key pressed) = 0, set v9 = 0.
2. Delay and poll input (keys are processed while waiting, which reduces input lag).
3. Ego direction: if the program controls ego, v6 = ego.direction; if the player does, ego.direction = v6.
4. Store the old score and the sound flag (flag 9).
5. Run logic 0 in a loop. **If it returns "restart"** (`new.room`, restart, restore), reset v9, v5, v4 and flag 2, and **run logic 0 again in the same cycle**.
6. Set ego.direction = v6. Redraw the status line if the score or sound flag changed.
7. Reset v5, v4, flag 5 (new room), flag 6 (restart) and flag 12 (restore). Update and draw objects unless in text mode.

**Message windows (`ui/msg.c`)**
- **Flag 15** set: the window stays open (until `close.window`), and flag 15 is then reset.
- Otherwise, if **v21 = 0**, the window waits for Enter (returns true) or Esc (returns false), then closes. If v21 > 0, it closes after v21 × 10 interpreter ticks **or on any key press, whichever comes first**, and v21 is then reset to 0.
- **Timing:** one interpreter tick = 50 ms (`DELAY_MULT` in `sys/delay.c`, so 20 ticks per second), which means v21 is in half-seconds. The cycle delay is also based on this: each cycle lasts at least **v10 × 50 ms** (`do_delay()`), with input polled while waiting.

## Faithfulness leads in jsyang (found by reading the code; confirm each by testing)

Add these to the Phase 2/3 work. For each one, write a short repro note (game, room, input), check it against ScummVM, then fix it the way NAGI does it.

- [ ] **`new.room` doesn't abort the current logic.** jsyang's `agi_new_room` only moves logic 0's read position to its scan start. The room logic that called `new.room` keeps running until its `return`. In NAGI, `new_room()` returns a null pointer, which stops execution immediately, and the main loop restarts logic 0 in the same cycle (see "Start of each cycle", step 5). Implement this as an explicit restart signal (e.g. a sentinel return value or a thrown `RestartLogic0` caught in `cycle()`), and apply the same signal to `restart.game` and `restore.game`.
- [ ] **Argument counts come from JS function parameter counts.** `logic.js` reads `actionFunc.length` bytes as arguments. Default parameters, rest parameters or a typo silently throw off the reading of the bytecode. Port NAGI's explicit argument-count table from `logic/cmd_table.c` and use it in `logic.js`. Add a startup check comparing the table against the JS functions.
- [ ] **Keystrokes are dropped.** `handleInput()` empties `keyboardCharBuffer` and `keyboardSpecialBuffer` at the end of every cycle, so keys pressed during a message window or a slow cycle are lost. Follow NAGI's event queue (`ui/events.c`) instead.
- [ ] **The input line isn't drawn and nothing is parsed.** `handleInput()` builds `state.inputBuffer` and sets flag 2 on Enter, but nothing splits the text into words or draws the line. This is the core Phase 2 job: port `ui/parse.c` and `ui/cmd_input.c`. Also note that jsyang sets flag 2 on Enter itself, while NAGI sets it in `parse()` only if at least one word was stored.
- [ ] **Condition evaluation.** `parseLogic()` builds JS expression strings for `if` conditions. Check that short-circuit order and side effects (notably `said()` setting flag 4) match NAGI's `logic/logic_eval.c`, including `or` groups and `not`.
- [ ] **Games run at twice the original speed.** `index.js` → `AGI.render()` waits `1000 / FPS × max(v10, 1)` ms per cycle, with `FPS = 40`, which is **v10 × 25 ms**. NAGI's `do_delay()` (`sys/delay.c`) waits **v10 × 50 ms**. With v10 = 0 there's no wait at all, apart from a 1 ms sleep. NAGI also cuts the wait short as soon as flag 2 is set (the player entered a command). *(Found 2026-11-19 by comparing the two sources.)*
- [ ] **Placing ego at the screen edge in `new.room`.** The case for edge code 3 has the author's own comment: `// todo: maybe a bug here! not sure this is correct!`. Compare all four cases with `new_room.c`.

## Add to CLAUDE.md

So that Claude Code reads this file automatically, add this line to CLAUDE.md, for example right under the "Ground rules" section:

```
@docs/NAGI-REFERENCE.md
```

(Adjust the path to wherever you put this file. Claude Code expands `@path` lines in CLAUDE.md as imports.)
