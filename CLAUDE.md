# CLAUDE.md — AGI interpreter fork (handover)

This file brings Claude Code up to speed on this project. Read it at the start of every session.

## Project in one paragraph

This is a browser-based interpreter for Sierra's AGI engine (King's Quest 1–3, Space Quest 1–2, Police Quest 1, Leisure Suit Larry 1 and others, 1984–1989). It is a fork of **jsyang/agi**, which is itself a fork of r1sc/agi.js. It is a portfolio project for Reinier Feijen (reinierfeijen.nl). The long-term goal is an AI layer: first an AI narrator that writes witty in-world replies when the player types a command the game doesn't understand, later voice input. **The current goal is only a complete, faithful interpreter with the original typed text input.** Do not add AI features, hooks or new UI beyond what the phases below ask for.

## Ground rules

- **Faithfulness first.** Behaviour should match the original Sierra interpreter. If you're unsure how something should behave, look it up in NAGI (see below). If NAGI doesn't settle it, say so and propose how to verify it. Don't guess silently.
- **License is GPL-3** (inherited). Keep the LICENSE file and credit r1sc, jsyang and NAGI in the README.
- Keep changes small and reviewable. One phase item per commit where practical.
- Ask before large refactors, such as converting to TypeScript wholesale or restructuring `src/`.

## NAGI: the reference implementation

**NAGI** (New Adventure Game Interpreter) by Nick Sonneveld is a C/SDL2 AGI interpreter written by **disassembling Sierra's original interpreter**. Many of its source files start with a comment listing the original function names and code-segment addresses. **NAGI is the final authority on how AGI behaves.** The owner trusts it as battle-tested, so it outranks the written specs, ScummVM and jsyang's code.

- **Source:** https://github.com/sonneveld/nagi, cloned into the git-ignored `reference/nagi/`. Re-clone it there if it's missing. Never vendor it into the repo.
- **v3 games:** NAGI supports AGI v2 and v3 (`res/res_lzw.c`, `version/`), so it's also the starting point if v3 support ever comes into scope.
- **File map:** [docs/nagi-map.md](docs/nagi-map.md) maps NAGI's source files to the jsyang files that do the same job.

**Reference order when behaviour is unclear:**
1. NAGI source.
2. ScummVM's AGI engine: a cross-check, and handy for running games side by side.
3. The AGI specifications (ScummVM wiki / AGIWiki).

**License rules for porting.** NAGI uses the **X11 license** (permissive, MIT-style), which is compatible with GPL-3. Its license text is in `licenses/NAGI-LICENSE.txt`, and the README credits NAGI. In every JS file containing code ported from NAGI:
- Add a header comment like this: `Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt`.
- Name the NAGI source file each piece came from.
- Never use Nick Sonneveld's name to endorse or promote the project.

**Porting style:** translate behaviour and control flow faithfully, but write idiomatic JS. Don't reproduce C pointer arithmetic where an index or array does the same job. Keep the original function names from NAGI's header comments in a comment above each ported function, so it can be traced back.

## Current state of the code (as found 2026-11-19)

- Plain JavaScript ES modules in `src/` (~4,700 lines). Key files:
  - `interpreter.js`: main loop, keyboard handlers (`window.onkeypress` / `onkeydown` around line 55–60), UI wiring.
  - `logic.js`: logic bytecode execution. It throws `Test not implemented` / `Action not implemented` for unknown opcodes.
  - `logicCommands.js`: implementations of AGI commands (`agi_*`).
  - `resources.js`: loads resources, including `extractWords()`, which decodes WORDS.TOK into `wordGroups`.
  - `state.js`: global game state (`variables`, `flags`, `strings`, `testSaid`, `playerSaid`, …).
  - `playerCommandSystem.js`: **jsyang's replacement for typed input.** It collects word-group combinations from `said()` tests as they are evaluated and shows them as clickable buttons with a search filter. There is no free-text parser.
  - `screen.js`, `bitmap.js`, `view.js`: rendering. `sound.js`, `soundEmulator.js`: PCjr sound. `persist.js`, `playerSaveSystem.js`: save and load. `tts.js`: browser text-to-speech of dialog.
  - `specific-games.md`: known per-game issues (SQ1, SQ2, demo pack).
- `agi_test_said(...groups)` compares a joined string of word-group numbers against `state.playerSaid`. That's a placeholder for real `said()` semantics.
- `handleInput()` in `interpreter.js` builds `state.inputBuffer` and sets flag 2 on Enter, but nothing splits the text into words or draws the input line.
- Commands that are empty or stubs: `show.pri.screen`, `show.mem`, `obj.status.v`, `return` (verify), `script.size`, `trace.info`, `enable.member`, `disable.member`, `status.line.on`, `status.line.off`, `menu.input`, `toggle.monitor`, `init.joy`, `version`, `echo.line`, `cancel.line`, `parse`, `close.window`. Also `set.cursor.char` returns 0 without doing anything. `new.room` is implemented but not faithfully (see Phase 2, main cycle).
- Only AGI version 2 is supported (the resources code has TODOs for v3 and LZW).
- **Build (since Phase 0):** Vite. `npm run dev` runs the dev server on :3000. `npm run build` writes a minified build to `dist/`, and `npm start` (`vite preview`) serves it on :3000. `npm run typecheck` runs tsc on files with `// @ts-check` (strict mode). `font.bin` lives in `public/`. `tools/games-plugin.js` serves `games/` in both servers and lists them at `games/index.json`. `src/gameLibrary.js` chooses the game: `#<zip url>`, then `?game=<name>`, then the dropdown. Choosing a game (or opening `?game=`) loads and starts it right away. Clicking the canvas pauses and resumes. Choosing another game reloads the page, because module-global interpreter state cannot be reset.
- **Argument counts:** `logic.js` takes the number of argument bytes from each `agi_*` command function's `.length`. Default parameters, rest parameters or a typo silently throw off the reading of the bytecode, and so would a minifier that drops unused parameters (Vite's doesn't; checked for all 177 commands). Until Phase 1 replaces this with NAGI's table, never give command functions default or rest parameters.
- **Typing:** `// @ts-check` + JSDoc is added to files as they are touched (agreed 2026-11-19). `index.js` is not checked yet because of the untyped `window.AGI` global.

## Test games

The owner has all the original Sierra AGI games locally, in `games/<name>/` (git-ignored). Primary test set:
- **Space Quest 1 and 2** (jsyang already fixed several room bugs here), **Leisure Suit Larry 1**, **King's Quest 1–3**, **Police Quest 1**.
- Out of scope for now: v3 games (King's Quest 4, Gold Rush, Manhunter 1 and 2).

## Plan

Work through the phases in order. Each phase has a definition of done. Update the checkboxes in this file as items are finished.

Items marked *(lead)* were found by reading jsyang's code next to NAGI's. For each one, first write a short repro note (game, room, input) and confirm the difference by testing. Then fix it the way NAGI does it.

### Phase 0: Set up the fork
- [x] Fix the build: move to Vite. A minified production build must work.
- [x] Separate build output (`dist/`) from game data (`games/<name>/`, git-ignored). Update the server and `index.html` to match.
- [x] A simple way to choose which local game to load (query string or dropdown). ZIP loading already exists; keep it.
- [x] Optional, ask first: add `// @ts-check` and JSDoc types to files as they are touched.
- [x] README: how to run, where to put games, credits, license.

Phase 0 was verified on 2026-11-19: headless Chrome loaded SQ1, KQ1–3, LSL1 and PQ1 from `games/` (and SQ1 from a ZIP) in both the production build and the dev server. SQ2 was added to `games/` afterwards.

**Done when:** `npm run build` and `npm start` (or equivalent) work, and a game loads from `games/`.

### Phase 1: Tools for testing
- [ ] Debug panel (toggle with a key that doesn't clash with AGI's F-keys or Ctrl shortcuts). It shows the current room (v0), the last parsed words and word groups, the variables and flags that changed, and the last logic message printed.
- [ ] Implement `show.pri.screen` (show the priority buffer) and add it to the debug panel.
- [ ] Port NAGI's command table (`logic/cmd_table.c`: names and **argument counts**) and use it in `logic.js` instead of the JS functions' `.length`. Add a startup check that compares the table with the JS functions. *(lead)*
- [ ] Collect unimplemented opcodes in a visible list or console summary, not only as thrown errors.
- [ ] Record and replay input: record keystrokes plus the game cycle they happened in to JSON, and replay them deterministically. Check whether the random number generator (`random` command) needs seeding for deterministic replay.

**Done when:** a recorded session of the start of Space Quest 1 replays identically.

### Phase 2: Typed input the way AGI does it (the main job)

Restore the original text parser by porting NAGI's `ui/parse.c`, `ui/cmd_input.c` and `cmd_said` from `logic/logic_eval.c`. The facts below were checked in NAGI's source.

**Main cycle.** These come first, because the parser depends on when flags are reset.
- [ ] **Cycle order** (`nagi_main.c`). Each cycle does the following, in this order:
  1. Clear controllers, reset flag 2, reset flag 4, set v19 (key pressed) = 0, set v9 = 0.
  2. Delay and poll input (keys are processed while waiting, which reduces input lag).
  3. Ego direction: if the program controls ego, v6 = ego.direction; if the player does, ego.direction = v6.
  4. Store the old score and the sound flag (flag 9).
  5. Run logic 0 in a loop. **If it returns "restart"** (`new.room`, restart, restore), reset v9, v5, v4 and flag 2, and **run logic 0 again in the same cycle**.
  6. Set ego.direction = v6. Redraw the status line if the score or sound flag changed.
  7. Reset v5, v4, flag 5 (new room), flag 6 (restart) and flag 12 (restore). Update and draw objects unless in text mode.
- [ ] **Cycle timing** (`sys/delay.c`). One interpreter tick is 50 ms (`DELAY_MULT`, 20 ticks per second). A cycle lasts at least **v10 × 50 ms** (`do_delay()`), with input polled while waiting. The wait ends early as soon as flag 2 is set. With v10 = 0 there's no wait beyond a 1 ms sleep. jsyang's `AGI.render()` in `index.js` waits `1000 / FPS × max(v10, 1)` ms with `FPS = 40`, which is **v10 × 25 ms**, so games run at twice the original speed. *(lead)*
- [ ] **`new.room` must abort the current logic.** jsyang's `agi_new_room` only moves logic 0's read position to its scan start, so the room logic that called `new.room` keeps running until its `return`. In NAGI, `new_room()` returns a null pointer, which stops execution immediately, and the main loop restarts logic 0 in the same cycle (step 5 above). Implement this as an explicit restart signal (e.g. a sentinel return value, or a thrown `RestartLogic0` caught in `cycle()`), and use the same signal for `restart.game` and `restore.game`. *(lead)*
- [ ] **Placing ego at the screen edge in `new.room`.** The case for edge code 3 has the author's own comment: `// todo: maybe a bug here! not sure this is correct!`. Compare all four cases with `new_room.c`. *(lead)*
- [ ] **Keystrokes are dropped.** `handleInput()` empties `keyboardCharBuffer` and `keyboardSpecialBuffer` at the end of every cycle, so keys pressed during a message window or a slow cycle are lost. Use an event queue like NAGI's `ui/events.c` instead. *(lead)*
- [ ] **Condition evaluation.** `parseLogic()` builds JS expression strings for `if` conditions. Check that short-circuit order and side effects (notably `said()` setting flag 4) match NAGI's `logic/logic_eval.c`, including `or` groups and `not`. *(lead)*

**Input line** (`ui/cmd_input.c`)
- [ ] Drawn on the row set by `configure.screen`. The prompt character comes from `set.cursor.char`. Respect `accept.input`/`prevent.input`. Handle typing, backspace and Enter. The maximum length follows NAGI.
- [ ] `echo.line` (F3 by default, which repeats the previous command) and `cancel.line`.

**Parser** (`ui/parse.c`: `parse()`, `parse_read()`, `word_find()`)
- [ ] **Cleaning the text:** the separator characters `` ,.?!();:[]{}`` and space end a word, and several in a row count as one. The characters `` ' ` - " `` are removed entirely. The parse buffer is 42 characters.
- [ ] **Dictionary lookup:** use the WORDS.TOK first-letter index, then find the **longest match**, because entries can contain spaces. Characters in WORDS.TOK are XOR 0x7F, and the high bit marks the last character of an entry. The word-group number (2 bytes, big-endian) follows that last character. A word that doesn't start with a–z is never found, so it counts as unknown.
- [ ] **Filler:** word group **0** is skipped without being stored. A single-letter word `a` or `i` is skipped too.
- [ ] **Storing words:** at most **10 words** are stored (`WORD_BUF_SIZE`).
- [ ] **Unknown word:** store it, set **v9 = (number of words stored so far) + 1** (1-based), and stop parsing.
- [ ] **Flag 2:** set it only if at least one word was stored (including an unknown one). jsyang currently sets flag 2 on Enter itself.
- [ ] **`parse(strNo)`:** first reset flags 2 and 4, then parse `string[strNo]`, but only if the string number is below 12.

**`said()`** (`cmd_said` in `logic/logic_eval.c`)
- [ ] It only tries to match if there are stored words, **flag 4 is clear and flag 2 is set**. If not, it returns false, but still skips its argument bytes.
- [ ] **Matching:** word groups are compared in order. Group **1** matches any single word. Group **9999** matches the rest of the line, however long, and ends the comparison successfully. Otherwise the number of words must match exactly: no extra or missing player words.
- [ ] **On a match:** **set flag 4** and return true. Because flag 4 is now set, every later `said()` in the same cycle returns false.
- [ ] **Bytecode arguments:** a count byte, followed by 2-byte **little-endian** word-group numbers.

**Other**
- [ ] Keep `playerCommandSystem.js` (the buttons) as a hidden debug view, off by default. Don't delete it; it's useful later.
- [ ] Unit tests for the tokeniser and `said()` matcher, using a small hand-made word list, so no copyrighted files are needed.

**Done when:** a list of test inputs gives the same responses in Space Quest 1 as the original behaviour, checked against ScummVM side by side. Wherever this interpreter and ScummVM differ, NAGI's source decides. The list should cover a normal command, filler words, a multi-word dictionary phrase, an unknown word, a command that's recognised but not handled in this room, and "anyword"/"rol" cases.

### Phase 3: Text windows and screen elements
- [ ] `print`/`print.at` (`ui/msg.c`, `ui/window.c`, `ui/agi_text.c`): the bordered message window with the original word-wrap width and placement. Implement `close.window`. Closing rules:
  - **Flag 15 set:** the window stays open until `close.window`, and flag 15 is then reset.
  - **v21 = 0:** the window waits for Enter (returns true) or Esc (returns false), then closes.
  - **v21 > 0:** the window closes after v21 × 10 ticks (v21 is in half-seconds) **or on any key press, whichever comes first**, and v21 is then reset to 0.
- [ ] Check `display`, `clear.lines`, `text.screen`/`graphics` and `set.text.attribute` against NAGI.
- [ ] Status line (`ui/status.c`): score and sound on/off, with `status.line.on`/`off`. It's drawn in the game screen; jsyang currently shows the score in HTML (`updateScore()`).
- [ ] Inventory screen (`status` command; `objects.c`, `obj_show.c`) and `obj.status.v`.
- [ ] Save and restore (`state_io.c`, `state_info.c`): fix the known issue in `persist.js` (`script.save` isn't implemented; restoring in SQ2 room 5 puts ego in the wrong place). Check the game-ID check.
- [ ] Remaining stubs as they come up: `menu.input`, `version`, `enable.member`/`disable.member`, `script.size`, `show.mem`, `trace.info`, `init.joy`. No-ops are fine where the original effect doesn't matter, but leave a comment saying why.

### Phase 4: Play-test
- [ ] Play Space Quest 1 from start to finish.
- [ ] Play at least the first major section of SQ1, SQ2 and LSL1. Compare doubtful moments against ScummVM side by side, and settle any difference with NAGI's source.
- [ ] Turn `specific-games.md` into a maintained bug list with a status for each item.

### Out of scope for now
AGI v3 games; mouse and touch input; mobile layout; any AI or LLM features; visual redesigns.

## Notes for the later AI phase (don't build yet; just don't block it)

The narrator will hook into the moment **input was received (flag 2) but nothing matched (flag 4 still clear)** at the end of a cycle, using **v9** for unknown words. Most games print their own "I don't understand" style message from logic 0, and the narrator will intercept or replace that message. Keep the parser and the message-printing code cleanly separated so that this hook is easy to add later. Typed input, the input line and `print` should each be something that can be called or overridden on its own.
