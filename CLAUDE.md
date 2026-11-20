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
  - `screen.js`, `bitmap.js`, `view.js`: rendering. `sound.js`, `soundEmulator.js`: PCjr sound. `persist.js`: save, restore and restart (since Phase 3; `playerSaveSystem.js` is gone). `tts.js`: browser text-to-speech of dialog.
  - `specific-games.md`: known per-game issues (SQ1, SQ2, demo pack).
- **Typed input (since Phase 2):** `events.js` queues key events (NAGI `ui/events.c`), `input.js` polls them, edits and draws the input line (`ui/cmd_input.c`), and `parser.js` holds the parser and `said()` matcher (`ui/parse.c`, `cmd_said`). `parser.js` has no interpreter state; `npm test` runs its unit tests (`test/`, node:test, hand-made dictionary). The word-group buttons are hidden; `?wordbuttons` or `AGI.toggleWordButtons()` shows them.
- **Main loop (since Phase 2):** `AGI.loop()` in `index.js` polls input every 5 ms and runs a cycle every v10 × 50 ms or when flag 2 is set (NAGI `sys/delay.c`). `interpreter.js` splits a cycle into `beginCycle()` (resets) and `runCycle()` in NAGI's order. `new.room`, `restart.game` and `restore.game` return `RESTART_LOGIC_0` (`constants.js`), which stops every running logic; `runCycle()` then runs logic 0 again. `if` conditions are evaluated by a port of NAGI's `execute_if()` in `logic.js`.
- Commands that do nothing on purpose (each has a comment saying why): `show.mem`, `obj.status.v`, `trace.on`, `trace.info`, `toggle.monitor`, `init.joy`. Still to check: `return` (verify). Mouse and v3-only commands are reported as stubs (`diagnostics.js`).
- Only AGI version 2 is supported (the resources code has TODOs for v3 and LZW).
- **Build (since Phase 0):** Vite. `npm run dev` runs the dev server on :3000. `npm run build` writes a minified build to `dist/`, and `npm start` (`vite preview`) serves it on :3000. `npm test` runs the unit tests. `npm run typecheck` runs tsc on files with `// @ts-check` (strict mode). `font.bin` lives in `public/`. `tools/games-plugin.js` serves `games/` in both servers and lists them at `games/index.json`. `src/gameLibrary.js` chooses the game: `#<zip url>`, then `?game=<name>`, then the dropdown. Choosing a game (or opening `?game=`) loads and starts it right away. Clicking the canvas pauses and resumes. Choosing another game reloads the page, because module-global interpreter state cannot be reset.
- **Argument counts (since Phase 1):** `src/cmdTable.js` holds NAGI's `cmd_table`/`eval_table`: per opcode the JS function name, the number of argument bytes and NAGI's name. `logic.js` reads arguments with these counts, not the JS functions' `.length`. `checkCommandTable()` (`src/diagnostics.js`) warns at start-up if a function's parameter count differs. A command without a function is reported (console, `AGI.unimplemented()`, debug panel) and skipped, as NAGI does; so are known stubs.
- **Animated objects (since the movement port, 2026-11-19):** `src/objects.js` ports NAGI's `view/*.c`: object state with NAGI's field names and flags (`O`, `MT`, `CY`), all object commands (merged into `commands`), the per-cycle update (`objsDirCalc()` before logic 0, `objtableUpdate()` after), contact, control lines, the spiral search for a free spot, priority bands, and `add.to.pic` with its feet box. Objects are drawn into `state.picBuffer`, NAGI's picture buffer (priority << 4 | colour, written by `bitmap.js` in drawing order), with saved backgrounds, and only changed areas are copied to the screen. jsyang's separate priority buffers still exist for the picture fill code.
- **Testing tools (since Phase 1):** debug panel (`src/debugPanel.js`; Ctrl+`, `?debug`, `AGI.toggleDebug()`). Every session is recorded (`src/recorder.js`): input events stamped with the cycle, the random seed and typed answers, game-clock ticks, and per-cycle hashes of state, objects and screen. `AGI.downloadRecording()` saves it; `AGI.replay(rec)` replays it and reports the first differing cycle (`AGI.replayResult()`). `npm run replay -- <files>` does that in headless Chrome (`tools/replay.js`, needs the game in `games/`). `test/replays/` holds recordings; when behaviour changes on purpose, record them again. All input must go through the event queue (`events.js`) and outside values through `recordValue()`, or replays break. Messages and questions go through `src/dialogs.js`.
- **Waiting inside a command (since Phase 3, 2026-11-20):** `Logic.parseLogic()`, `executeIf()`, `agi_call` and `runCycle()` are generators. A command that waits for the player (`print`, `show.pri.screen`, ...) is a generator too and `yield`s once per poll (`src/wait.js`: `userBooleanPoll()`, `waitTicksOrReply()`); the game loop in `index.js` keeps calling `next()` on the running cycle, and the logic carries on at the same byte, as when NAGI blocks in the command. `have.key` yields once when no key is queued, because text screens loop on it until a key arrives (NAGI's `event_read()` fetches system events on every call). Events that arrive while a cycle is paused are recorded with the cycle's resume number, and each cycle's number of resumes and each wait's length in polls are recorded too (`recorder.js`: `cyclePaused()`, `cycleResume()`, `Recording.resumes`, `Recording.waits`), so replays stay exact; a replay whose cycle needs more resumes than recorded ends as failed.
- **Message windows (since Phase 3):** `src/msg.js` ports `ui/msg.c` (`messageBox()`, `messageBoxDraw()`, `closeWindow()`, `printAt()`); the word wrap and %-codes are in `src/wordwrap.js` (pure, unit-tested in `test/wordwrap.test.js`). `dialogs.js` logs each window (debug panel) and reads it out (TTS). `status`, `show.obj` and jsyang's `text.screen` collection still show their text in a plain message window until their own screens are ported.
- **Screen layout and text (since Phase 3):** text row r is pixel rows r×8 to r×8+7 (`screen.js`: `chPut()`, `chClear()`), and the picture starts at row `window_row_min` (`state.playTop`, from `configure.screen`), as in NAGI. `src/text.js` ports `ui/agi_text.c` and `ui/window.c`: the text attribute (`state.textFG`, `textBG`, `textComb`), the text cursor, `text.screen`/`graphics` (`state.textMode`), clearing rows. `display` and the input line write through it, with the same word wrap and %-codes as message windows.
- **Typed answers (since Phase 3):** `get.string`, `get.num` and the save/restore dialogs type on the screen with NAGI's `string_edit()` (`src/agiString.js`), which reads key events like everything else (jsyang used the browser's `prompt()`). `input.js` has NAGI's `input_edit_on()`/`input_edit_off()`, which take the cursor character off and put it back at the text cursor.
- **Scripted sessions:** `npm run record -- <script.json> --out <file>` (`tools/record.js`) types keys into a game in headless Chrome, takes screenshots and saves the recording. `test/replays/*.script.json` are the scripts behind the recordings there; run them again and copy the output over when behaviour changes on purpose. `npm run replay -- <files> --realtime` replays at game speed.
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
- [x] Debug panel (toggle with a key that doesn't clash with AGI's F-keys or Ctrl shortcuts). It shows the current room (v0), the last parsed words and word groups, the variables and flags that changed, and the last logic message printed.
- [x] Implement `show.pri.screen` (show the priority buffer) and add it to the debug panel.
- [x] Port NAGI's command table (`logic/cmd_table.c`: names and **argument counts**) and use it in `logic.js` instead of the JS functions' `.length`. Add a startup check that compares the table with the JS functions. *(lead)*
- [x] Collect unimplemented opcodes in a visible list or console summary, not only as thrown errors.
- [x] Record and replay input: record keystrokes plus the game cycle they happened in to JSON, and replay them deterministically. Check whether the random number generator (`random` command) needs seeding for deterministic replay.

**Done when:** a recorded session of the start of Space Quest 1 replays identically.

Phase 1 status (2026-11-19): done. `test/replays/sq1-start.agirec.json` (intro, name, walking, five commands; re-recorded with the sound switched off part-way after the sound fixes) replays with 0 differences in the dev server and the production build, fast and in real time; with one recorded key removed it fails at that key's cycle. Random needed seeding: it is now NAGI's generator (`src/rng.js`) with a recorded seed. The clock (v11-v14) now counts game time as in NAGI (`src/clock.js`), with recorded ticks.

Found during Phase 1, not fixed yet:
- ~~`put`, `get.room.v` and `word.to.string` have no implementation.~~ Done (and `put.v` fixed). Inventory items now start in the room the OBJECT file gives them (they all started in room 0; KQ3 ended the game at once).
- ~~`sound` doesn't reset its flag when a sound starts; with sound off its flag is never set.~~ Done, following NAGI; also stopping no longer sets a finished sound's flag again, and `new.room`/`restart.game` stop the sound. Whether a sound is playing changes only through the event queue, so replays match. `test/replays/kq3-start.agirec.json` covers KQ3's start.
- ~~`show.pri.screen` lets the rest of the cycle run before waiting for Enter/Esc~~: it now waits inside the command (2026-11-20).

### Phase 2: Typed input the way AGI does it (the main job)

Restore the original text parser by porting NAGI's `ui/parse.c`, `ui/cmd_input.c` and `cmd_said` from `logic/logic_eval.c`. The facts below were checked in NAGI's source.

**Main cycle.** These come first, because the parser depends on when flags are reset.
- [x] **Cycle order** (`nagi_main.c`). Each cycle does the following, in this order:
  1. Clear controllers, reset flag 2, reset flag 4, set v19 (key pressed) = 0, set v9 = 0.
  2. Delay and poll input (keys are processed while waiting, which reduces input lag).
  3. Ego direction: if the program controls ego, v6 = ego.direction; if the player does, ego.direction = v6.
  4. Store the old score and the sound flag (flag 9).
  5. Run logic 0 in a loop. **If it returns "restart"** (`new.room`, restart, restore), reset v9, v5, v4 and flag 2, and **run logic 0 again in the same cycle**.
  6. Set ego.direction = v6. Redraw the status line if the score or sound flag changed.
  7. Reset v5, v4, flag 5 (new room), flag 6 (restart) and flag 12 (restore). Update and draw objects unless in text mode.
- [x] **Cycle timing** (`sys/delay.c`). One interpreter tick is 50 ms (`DELAY_MULT`, 20 ticks per second). A cycle lasts at least **v10 × 50 ms** (`do_delay()`), with input polled while waiting. The wait ends early as soon as flag 2 is set. With v10 = 0 there's no wait beyond a 1 ms sleep. jsyang's `AGI.render()` in `index.js` waits `1000 / FPS × max(v10, 1)` ms with `FPS = 40`, which is **v10 × 25 ms**, so games run at twice the original speed. *(lead)*
- [x] **`new.room` must abort the current logic.** jsyang's `agi_new_room` only moves logic 0's read position to its scan start, so the room logic that called `new.room` keeps running until its `return`. In NAGI, `new_room()` returns a null pointer, which stops execution immediately, and the main loop restarts logic 0 in the same cycle (step 5 above). Implement this as an explicit restart signal (e.g. a sentinel return value, or a thrown `RestartLogic0` caught in `cycle()`), and use the same signal for `restart.game` and `restore.game`. *(lead)*
- [x] **Placing ego at the screen edge in `new.room`.** The case for edge code 3 has the author's own comment: `// todo: maybe a bug here! not sure this is correct!`. Compare all four cases with `new_room.c`. *(lead)*
- [x] **Keystrokes are dropped.** `handleInput()` empties `keyboardCharBuffer` and `keyboardSpecialBuffer` at the end of every cycle, so keys pressed during a message window or a slow cycle are lost. Use an event queue like NAGI's `ui/events.c` instead. *(lead)*
- [x] **Condition evaluation.** `parseLogic()` builds JS expression strings for `if` conditions. Check that short-circuit order and side effects (notably `said()` setting flag 4) match NAGI's `logic/logic_eval.c`, including `or` groups and `not`. *(lead)*

**Input line** (`ui/cmd_input.c`)
- [x] Drawn on the row set by `configure.screen`. The prompt character comes from `set.cursor.char`. Respect `accept.input`/`prevent.input`. Handle typing, backspace and Enter. The maximum length follows NAGI.
- [x] `echo.line` (F3 by default, which repeats the previous command) and `cancel.line`.

**Parser** (`ui/parse.c`: `parse()`, `parse_read()`, `word_find()`)
- [x] **Cleaning the text:** the separator characters `` ,.?!();:[]{}`` and space end a word, and several in a row count as one. The characters `` ' ` - " `` are removed entirely. The parse buffer is 42 characters.
- [x] **Dictionary lookup:** use the WORDS.TOK first-letter index, then find the **longest match**, because entries can contain spaces. Characters in WORDS.TOK are XOR 0x7F, and the high bit marks the last character of an entry. The word-group number (2 bytes, big-endian) follows that last character. A word that doesn't start with a–z is never found, so it counts as unknown.
- [x] **Filler:** word group **0** is skipped without being stored. A single-letter word `a` or `i` is skipped too.
- [x] **Storing words:** at most **10 words** are stored (`WORD_BUF_SIZE`).
- [x] **Unknown word:** store it, set **v9 = (number of words stored so far) + 1** (1-based), and stop parsing.
- [x] **Flag 2:** set it only if at least one word was stored (including an unknown one). jsyang currently sets flag 2 on Enter itself.
- [x] **`parse(strNo)`:** first reset flags 2 and 4, then parse `string[strNo]`, but only if the string number is below 12.

**`said()`** (`cmd_said` in `logic/logic_eval.c`)
- [x] It only tries to match if there are stored words, **flag 4 is clear and flag 2 is set**. If not, it returns false, but still skips its argument bytes.
- [x] **Matching:** word groups are compared in order. Group **1** matches any single word. Group **9999** matches the rest of the line, however long, and ends the comparison successfully. Otherwise the number of words must match exactly: no extra or missing player words.
- [x] **On a match:** **set flag 4** and return true. Because flag 4 is now set, every later `said()` in the same cycle returns false.
- [x] **Bytecode arguments:** a count byte, followed by 2-byte **little-endian** word-group numbers.

**Other**
- [x] Keep `playerCommandSystem.js` (the buttons) as a hidden debug view, off by default. Don't delete it; it's useful later.
- [x] Unit tests for the tokeniser and `said()` matcher, using a small hand-made word list, so no copyrighted files are needed.

**Done when** both checks pass:
- **Claude's check (automated):** the unit tests pass, and a scripted list of inputs replays in Space Quest 1 (with Phase 1's record and replay, in headless Chrome) with the expected parsed words, v9, flags 2 and 4, and printed message. The expected values come from NAGI's source and the game's logic. The list covers a normal command, filler words, a multi-word dictionary phrase, an unknown word, a command that's recognised but not handled in this room, and "anyword"/"rol" cases.
- **The owner's check (by hand):** the owner types the same list, about ten inputs, into SQ1 in this interpreter and in ScummVM side by side, and reports any difference. Claude can't run ScummVM. Any difference is settled from NAGI's source.

Phase 2 status (2026-11-19): all items above are implemented. Checked so far: the unit tests pass, and in headless Chrome SQ1 room 2 gives the expected words, said() match and game reply for "look", "look at the floor", "pick up the gadget", "talk to man", "eat the door" (recognised, handled by a catch-all), "open door" and "look xyzzy" (unknown word, v9 = 2, 'I don't understand "xyzzy"'). Still open: a scripted replay with expected values per input (Phase 1's record and replay now exists), and the owner's side-by-side ScummVM check.

Found during Phase 2, not fixed yet (each needs a repro first):
- *(lead)* `new.room` keeps every loaded logic, so a room logic's `set.scan.start` survives leaving and re-entering the room. NAGI (`room_init()` → `logic_list_new_room()`) discards all logics except logic 0, and `logic_call()` discards a logic it had to load once the call returns.
- ~~`player.control` stops ego~~ and ~~`new.room` doesn't reset the objects like NAGI~~: fixed by the object port (`src/objects.js`).
- Not ported yet: NAGI discards all views, pictures and sounds on `new.room` (and `discard.view` discards every view loaded after it); here they stay loaded. ~~Saved games don't store the drawing lists or the picture buffer~~ (a restore replays the script, as NAGI does). ~~Objects are updated in text mode too~~ (fixed).
- ~~Text rows were drawn 7 pixels too high and the picture ignored `configure.screen`~~: fixed with the message windows (2026-11-20).
- ~~`restore.game` doesn't use the restart signal~~ and ~~`restart.game` doesn't ask "Press ENTER to restart"~~: both fixed with Phase 3's save and restore.
- ~~KQ3 threw in logic 107 at start-up~~: `get.room.v` was missing; fixed (see Phase 1 notes).

### Phase 3: Text windows and screen elements
- [x] `print`/`print.at` (`ui/msg.c`, `ui/window.c`, `ui/agi_text.c`): the bordered message window with the original word-wrap width and placement. Implement `close.window`. Closing rules:
  - **Flag 15 set:** the window stays open until `close.window` (or the next window, or `show.pic`); flag 15 is reset as soon as the window is drawn (NAGI `message_box()`).
  - **v21 = 0:** the window waits for Enter (returns true) or Esc (returns false), then closes.
  - **v21 > 0:** the window closes after v21 × 10 ticks (v21 is in half-seconds) **or when Enter or Esc is pressed**, whichever comes first, and v21 is then reset to 0. (This plan first said "any key"; NAGI's `has_user_reply()` only answers Enter and Esc, and other keys are read and dropped. Worth checking in ScummVM.)

  Done 2026-11-20 (`src/msg.js`, `src/wordwrap.js`, `src/wait.js`). Checked: word-wrap unit tests; in headless Chrome, SQ1's alarm narration and replies and KQ3's opening windows look right, v21 = 2 closes after about 1 s and ignores other keys, Esc closes early, flag 15 leaves the window open until `close.window`. The SQ1 and KQ3 replays were recorded again with windows (scripts in `test/replays/`) and pass fast and in real time. Not checked yet: `print.at` in a real game, and the owner's side-by-side look against ScummVM.
- [x] Check `display`, `clear.lines`, `text.screen`/`graphics` and `set.text.attribute` against NAGI.

  Done 2026-11-20 (`src/text.js`). jsyang's `display` ignored the text screen (it collected the text and showed it in a dialog at `graphics`), didn't fill in `%v|n` padding (KQ3's clock showed "0:0:2:2:2"), and every text colour came out white or grey. Now as NAGI: `display` wraps at 40 columns with %-codes; `clear.lines`/`clear.text.rect` clear to black or (any other colour) white; `set.text.attribute` gives black-on-white for any background in graphics mode and foreground | background << 4 on the text screen; `text.screen` clears to the text background and stops object updates; `graphics` redraws the picture and input line. Checked in headless Chrome with SQ1's help screen (text screen, then back to graphics) and KQ3's clock. Also fixed on the way: text screens froze the browser, because their logic loops on `have.key` (see "Waiting inside a command" above). The status line isn't redrawn by `graphics` yet (next item).
- [x] Status line (`ui/status.c`): score and sound on/off, with `status.line.on`/`off`. It's drawn in the game screen; jsyang currently shows the score in HTML (`updateScore()`).

  Done 2026-11-20 (`src/status.js`; the HTML score is gone). "Score:N of M" at column 1 and "Sound:on/off" at column 30, black on a white row at configure.screen's status row. Written by `status.line.on`, `new.room`, `graphics`, and at the end of logic 0 when the score or flag 9 changed (as `nagi_main.c`). NAGI also writes it after a restore: add that with the save/restore item. Checked in SQ1 (F2 shows "Sound:off") and KQ3.
- [x] Inventory screen (`status` command; `objects.c`, `obj_show.c`) and `obj.status.v`.

  Done 2026-11-20. `status` (`src/status.js`: `cmdStatus()`) shows "You are carrying:" on the text screen, two items to a row, black on light grey (NAGI's text-mode attribute 0x70, as in DOS). With flag 13 the arrow keys move a white-on-black selection and Enter/Esc set v25 to the item number/255; without it any key returns. `show.obj` (`objects.js`: `objShowDraw()`) draws the item's view at the bottom centre with its description in a message window, then restores the picture; a view that wasn't loaded is discarded again. `obj.status.v` stays a no-op: NAGI maps it to `cmd_do_nothing` (a debug window in Sierra's interpreter). Checked in KQ1 with items given from the console (layout, selection, v25, the walnut's `show.obj`); the SQ1 replay now opens the inventory. Worth comparing the colours with ScummVM.
- [x] Save and restore (`state_io.c`, `state_info.c`): fix the known issue in `persist.js` (`script.save` isn't implemented; restoring in SQ2 room 5 puts ego in the wrong place). Check the game-ID check.

  Done 2026-11-20 (`src/persist.js`, `src/script.js`, `src/agiString.js`). NAGI's dialogs: directory prompt, slot list (12 to save into, the saved ones to restore), description, "About to save/restore" confirmation; `set.simple` names a game to save and restore without them. Storage is localStorage: the "directory" (default: the game's folder name) names a set of 12 slots, and a slot's file is named as NAGI's, `<dir>\<game id>sg.<n>`. A saved game holds what NAGI's does (state, objects, inventory locations, the script, scan starts); a restore discards the room's resources and replays the script to rebuild the picture (`state_reload()`). The game-ID check is in: `set.game.id` is implemented and only the game's own saves are listed. `restart.game` asks "Press ENTER to restart" unless flag 16 is set. Checked in SQ2: right after `restore.game` every variable (except v22, set by the interpreter), every object and ego's position match the save; `test/replays/sq2-save.agirec.json` saves, walks away and restores. SQ2 room 5 itself wasn't visited. Restore and restart enable every menu item again, as NAGI's `menu_enable_all()`.
- [x] Remaining stubs as they come up: `menu.input`, `version`, `enable.member`/`disable.member`, `script.size`, `show.mem`, `trace.info`, `init.joy`. No-ops are fine where the original effect doesn't matter, but leave a comment saying why.

  Done 2026-11-20. The menu is NAGI's `ui/menu.c` (`src/menu.js`): `set.menu`, `set.menu.item`, `submit.menu`, `enable.item`/`disable.item` (disabled items shaded), `menu.input` (with flag 14) and `allow.menu`; it opens at the start of the next cycle (NAGI: at the start of the next input poll, during the delay), Enter sets the item's controller, Esc closes it. jsyang's HTML `<select>` menus are gone. `script.size` came with save/restore. `pause` and `quit` ask in a message window as NAGI's `base.c`. `version` shows this interpreter's name (NAGI shows its own; the original's text is unknown). `log` writes to the console. `show.mem`, `init.joy`, `toggle.monitor`, `trace.on` and `trace.info` do nothing, with a comment saying why. Checked in SQ1: the menu bar, moving between menus and items, choosing "About SQ"; the SQ1 replay opens the menu.

### Phase 4: Play-test
- [ ] Play Space Quest 1 from start to finish.
- [ ] Play at least the first major section of SQ1, SQ2 and LSL1. The owner does the play-testing and compares doubtful moments against ScummVM side by side. Claude settles any difference from NAGI's source and adds a repro (a recorded replay where possible).
- [ ] Turn `specific-games.md` into a maintained bug list with a status for each item.

### Out of scope for now
AGI v3 games; mouse and touch input; mobile layout; any AI or LLM features; visual redesigns.

## Notes for the later AI phase (don't build yet; just don't block it)

The narrator will hook into the moment **input was received (flag 2) but nothing matched (flag 4 still clear)** at the end of a cycle, using **v9** for unknown words. Most games print their own "I don't understand" style message from logic 0, and the narrator will intercept or replace that message. Keep the parser and the message-printing code cleanly separated so that this hook is easy to add later. Typed input, the input line and `print` should each be something that can be called or overridden on its own.
