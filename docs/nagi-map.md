# Where things live: NAGI → this project

NAGI's source is cloned in `reference/nagi/` (git-ignored); see the NAGI section in CLAUDE.md. Paths below are relative to `reference/nagi/src/` and this project's `src/`. The right-hand column describes jsyang's code as found on 2026-11-19. Update it when code moves.

| Area | NAGI | This project |
|---|---|---|
| Main cycle | `nagi_main.c` (main loop) | `interpreter.js` → `cycle()`, `handleInput()`; timing in `index.js` → `AGI.render()` |
| Cycle delay / ticks | `sys/delay.c` (`do_delay()`, `DELAY_MULT`) | `index.js` → `AGI.render()` |
| Logic execution | `logic/logic_execute.c`, `logic/logic_base.c` | `logic.js` → `parseLogic()` |
| Command table (names, **argument counts**) | `logic/cmd_table.c` | `constants.js` (names); argument count taken from the JS function's parameter count |
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
| Resources, v3 LZW | `res/`, `res/res_lzw.c` | `resources.js` (v2 only) |
