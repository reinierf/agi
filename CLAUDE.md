# CLAUDE.md — AGI interpreter fork (handover)

This file brings Claude Code up to speed on this project. Read it at the start of every session.

## Project in one paragraph

This is a browser-based interpreter for Sierra's AGI engine (King's Quest 1–3, Space Quest 1–2, Police Quest 1, Leisure Suit Larry 1 and others, 1984–1989). It is a fork of **jsyang/agi**, which is itself a fork of r1sc/agi.js. It is a portfolio project for Reinier Feijen (reinierfeijen.nl). The long-term goal is an AI layer: first an AI narrator that writes witty in-world replies when the player types a command the game doesn't understand, later voice input. **The current goal is only a complete, faithful interpreter with the original typed text input.** Do not add AI features, hooks or new UI beyond what the phases below ask for.

## Ground rules

- **Faithfulness first.** Behaviour should match the original Sierra interpreter. ScummVM's AGI engine is the reference when the specs are unclear. If you're unsure how something should behave, say so and propose how to verify it. Don't guess silently.
- **License is GPL-3** (inherited). Keep the LICENSE file and credit r1sc and jsyang in the README.
- Keep changes small and reviewable. One phase item per commit where practical.
- Ask before large refactors, such as converting to TypeScript wholesale or restructuring `src/`.

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
- Commands that are empty or stubs: `new.room` (verify; it may be implemented elsewhere), `show.pri.screen`, `show.mem`, `obj.status.v`, `return` (verify), `script.size`, `trace.info`, `enable.member`, `disable.member`, `status.line.on`, `status.line.off`, `menu.input`, `toggle.monitor`, `init.joy`, `version`, `echo.line`, `cancel.line`, `parse`, `close.window`. Also `set.cursor.char` returns 0 without doing anything.
- Only AGI version 2 is supported (the resources code has TODOs for v3 and LZW).
- **Build (since Phase 0):** Vite. `npm run dev` runs the dev server on :3000. `npm run build` writes a minified build to `dist/`, and `npm start` (`vite preview`) serves it on :3000. `npm run typecheck` runs tsc on files with `// @ts-check` (strict mode). `font.bin` lives in `public/`. `tools/games-plugin.js` serves `games/` in both servers and lists them at `games/index.json`. `src/gameLibrary.js` chooses the game: `#<zip url>`, then `?game=<name>`, then the dropdown. The first click on the canvas loads the game and the second click starts it (jsyang's original behaviour, kept).
- **Minification caveat:** `logic.js` uses each `agi_*` command function's `.length` to decide how many argument bytes to read. Never give command functions default or rest parameters, and if you change the minifier, check that unused parameters are kept.
- **Typing:** `// @ts-check` + JSDoc is added to files as they are touched (agreed 2026-11-19). `index.js` is not checked yet because of the untyped `window.AGI` global.

## Test games

The owner has all the original Sierra AGI games locally. Primary test set:
- **Space Quest 1 and 2** (jsyang already fixed several room bugs here), **Leisure Suit Larry 1**, **King's Quest 1–3**, **Police Quest 1**.
- Out of scope for now: v3 games (King's Quest 4, Gold Rush, Manhunter 1 and 2).

## Plan

Work through the phases in order. Each phase has a definition of done. Update the checkboxes in this file as items are finished.

### Phase 0: Set up the fork
- [x] Fix the build: move to Vite. A minified production build must work.
- [x] Separate build output (`dist/`) from game data (`games/<name>/`, git-ignored). Update the server and `index.html` to match.
- [x] A simple way to choose which local game to load (query string or dropdown). ZIP loading already exists; keep it.
- [x] Optional, ask first: add `// @ts-check` and JSDoc types to files as they are touched.
- [x] README: how to run, where to put games, credits, license.

Phase 0 was verified on 2026-11-19: headless Chrome loaded SQ1, KQ1–3, LSL1 and PQ1 from `games/` (and SQ1 from a ZIP) in both the production build and the dev server. SQ2 is not in `games/` yet.

**Done when:** `npm run build` and `npm start` (or equivalent) work, and a game loads from `games/`.

### Phase 1: Tools for testing
- [ ] Debug panel (toggle with a key that doesn't clash with AGI's F-keys or Ctrl shortcuts). It shows the current room (v0), the last parsed words and word groups, the variables and flags that changed, and the last logic message printed.
- [ ] Implement `show.pri.screen` (show the priority buffer) and add it to the debug panel.
- [ ] Collect unimplemented opcodes in a visible list or console summary, not only as thrown errors.
- [ ] Record and replay input: record keystrokes plus the game cycle they happened in to JSON, and replay them deterministically. Check whether the random number generator (`random` command) needs seeding for deterministic replay.

**Done when:** a recorded session of the start of Space Quest 1 replays identically.

### Phase 2: Typed input the way AGI does it (the main job)

Restore the original text parser. Follow the AGI specifications (ScummVM wiki: AGI/Specifications, and AGIWiki pages for WORDS.TOK, `said`, `parse`, flags and variables). Verify each point below against the spec or ScummVM source, since some details here are from memory:

- [ ] **Input line:** drawn on the row set by `configure.screen`. The prompt character comes from `set.cursor.char`. Respect `accept.input`/`prevent.input`. Handle typing, backspace and Enter. The maximum length follows the original.
- [ ] `echo.line` (F3 by default, which repeats the previous command) and `cancel.line`.
- [ ] **Tokenising:** lowercase the text, strip or treat punctuation as the original does, then match words against WORDS.TOK with the longest match first, because entries can contain several words.
- [ ] Word group 0 is filler ("the", "a", …) and is dropped.
- [ ] An unknown word sets **v9** to the position of the unknown word and stops parsing. Check the exact convention: 1-based or 0-based.
- [ ] Set **flag 2** (player entered a command) and reset **flag 4** (`said` accepted the input) on new input. Clear them at the right point in the interpreter cycle.
- [ ] **`said()` rules:** the number of words must match exactly. Group **1** ("anyword") matches any single word. Group **9999** ("rol", rest of line) matches everything that follows. On a successful match, set flag 4. Once flag 4 is set, later `said()` calls in the same cycle return false.
- [ ] Implement `parse(strNo)`, which runs the same parser on a string variable.
- [ ] Keep `playerCommandSystem.js` (the buttons) as a hidden debug view, off by default. Don't delete it; it's useful later.
- [ ] Unit tests for the tokeniser and `said()` matcher, using a small hand-made word list, so no copyrighted files are needed.

**Done when:** a list of test inputs gives the same responses as ScummVM in Space Quest 1. The list should cover a normal command, filler words, a multi-word dictionary phrase, an unknown word, a command that's recognised but not handled in this room, and "anyword"/"rol" cases.

### Phase 3: Text windows and screen elements
- [ ] `print`/`print.at`: the bordered message window with the original word-wrap width and placement. It waits for a key press, or closes automatically based on **v21** (check the units and the flag that controls this behaviour in the spec). Implement `close.window`.
- [ ] Check `display`, `clear.lines`, `text.screen`/`graphics` and `set.text.attribute` against ScummVM.
- [ ] Status line: score and sound on/off, with `status.line.on`/`off`.
- [ ] Inventory screen (`status` command) and `obj.status.v`.
- [ ] Save and restore: fix the known issue in `persist.js` (`script.save` isn't implemented; restoring in SQ2 room 5 puts ego in the wrong place). Check the game-ID check.
- [ ] Remaining stubs as they come up: `menu.input`, `version`, `enable.member`/`disable.member`, `script.size`, `show.mem`, `trace.info`, `init.joy` (no-ops are fine where the original effect doesn't matter, but leave a comment saying why).

### Phase 4: Play-test
- [ ] Play Space Quest 1 from start to finish.
- [ ] Play at least the first major section of SQ1, SQ2 and LSL1. Compare doubtful moments against ScummVM.
- [ ] Turn `specific-games.md` into a maintained bug list with a status for each item.

### Out of scope for now
AGI v3 games; mouse and touch input; mobile layout; any AI or LLM features; visual redesigns.

## Notes for the later AI phase (don't build yet; just don't block it)

The narrator will hook into the moment **input was received (flag 2) but nothing matched (flag 4 still clear)** at the end of a cycle, using **v9** for unknown words. Most games print their own "I don't understand" style message from logic 0, and the narrator will intercept or replace that message. Keep the parser and the message-printing code cleanly separated so that this hook is easy to add later. Typed input, the input line and `print` should each be something that can be called or overridden on its own.
