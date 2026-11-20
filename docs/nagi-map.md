# Where things live: NAGI → this project

NAGI's source is cloned in `reference/nagi/` (git-ignored); see the NAGI section in CLAUDE.md. Paths below are relative to `reference/nagi/src/` and this project's `src/`. The right-hand column describes jsyang's code as found on 2026-11-19. Update it when code moves.

| Area | NAGI | This project |
|---|---|---|
| Main cycle | `nagi_main.c` (main loop) | `interpreter.js` → `beginCycle()`, `runCycle()`; loop in `index.js` → `AGI.loop()` |
| Cycle delay / ticks | `sys/delay.c` (`do_delay()`, `DELAY_MULT`) | `index.js` → `AGI.loop()` |
| Logic execution | `logic/logic_execute.c`, `logic/logic_base.c` | `logic.js` → `parseLogic()` (a generator, so commands can wait), `executeIf()`, `skipTrueOr()`, `skipFalseAnd()`, `evalTest()` |
| Command table (names, **argument counts**) | `logic/cmd_table.c` | `cmdTable.js` → `ACTIONS`, `TESTS`; checked by `diagnostics.js` → `checkCommandTable()` |
| Random numbers | `sys/rand.c` | `rng.js` → `agiRand()` |
| Game clock (v11-v14) | `sys/time.c` | `clock.js` |
| Priority screen (`show.pri.screen`) | `picture/pic_add.c` | `logicCommands.js`, `screen.js` → `renderPriority()` |
| Wait for Enter/Esc, timed waits | `ui/events.c` (`user_bolean_poll()`, `has_user_reply()`), `sys/delay.c` (`calc_agi_tick()`) | `wait.js` → `userBooleanPoll()`, `waitTicksOrReply()`, `agiTick()` |
| Condition tests (incl. `said`) | `logic/logic_eval.c` | `logicCommands.js` (`agi_test_*`); `said` matching in `parser.js` → `saidMatches()` |
| Parser / WORDS.TOK lookup | `ui/parse.c` | `parser.js` → `parse()`, `cleanInput()`, `wordFind()`; raw WORDS.TOK in `resources.js` → `wordsTokData` |
| Input line, input polling | `ui/cmd_input.c`, `ui/controller.c` | `input.js` → `inputPoll()`, `inputRedraw()`, `echoLine()`, `cancelLine()` |
| Key events | `ui/events.c` | `events.js` → `keyToEvent()`, `eventRead()`, `charPoll()` |
| Message windows (`print`, `print.at`, `close.window`) | `ui/msg.c`, `ui/window.c`, `sys/gfx.c` (`gfx_msgbox()`) | `msg.js` → `messageBox()`, `messageBoxDraw()`, `closeWindow()`, `printAt()`; word wrap and %-codes in `wordwrap.js` → `wordwrap()` |
| Text drawing | `sys/chargen.c` (`ch_put()`, `ch_clear()`) | `screen.js` → `chPut()`, `chClear()`, `clearScreen()` |
| Text attribute, cursor, `text.screen`/`graphics`, `clear.lines`, `display` | `ui/agi_text.c`, `ui/window.c`, `ui/printf.c`, `ui/msg.c` (`cmd_display()`) | `text.js` → `textColour()`, `windowPutChar()`, `agiPrintf()`, `windowClear()`, `textScreen()`, `screenRedraw()`; `msg.js` → `display()` |
| Screen layout (picture at `window_row_min`) | `sys/gfx.c` (`gfx_update()`), `sys/vid_render.c` | `objects.js` → `renderUpdate()`, `screen.js` → `fillPicRect()`, `renderPriority()` |
| `get.string` / `get.num` | `ui/string.c` | `logicCommands.js` |
| Menus | `ui/menu.c` | `logicCommands.js`, `index.html` |
| Status line | `ui/status.c` | `interpreter.js` → `updateScore()` (HTML, not drawn in-game) |
| `new.room` | `new_room.c` | `logicCommands.js` → `agi_new_room` |
| Objects, motion, priority, drawing | `view/obj_*.c`, `view/view_base.c`, `picture/pic_add.c` | `objects.js` (object state, commands, `objtableUpdate()`, `objsDirCalc()`, drawing into `state.picBuffer`); cel data in `view.js` |
| Pictures | `res/res_pic.c`, `picture/` | `bitmap.js` |
| Inventory | `objects.c`, `obj_show.c` | `logicCommands.js` |
| Save / restore | `state_io.c`, `state_info.c` | `persist.js`, `playerSaveSystem.js` |
| Game detection / version quirks | `version/agi_crc.c`, `version/standard.c` | none |
| Sound | `sound/` | `sound.js`, `soundEmulator.js` |
| Resources, v3 LZW | `res/`, `res/res_lzw.c` | `resources.js` (v2 only) |
