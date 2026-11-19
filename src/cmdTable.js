// @ts-check
// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (logic/cmd_table.c)

/**
 * The AGI v2 command tables: for each opcode, the name of the JS function that runs it
 * (`agi_<name>` and `agi_test_<name>` in logicCommands.js), the number of argument bytes, and
 * NAGI's name for it. The argument counts come from NAGI's cmd_table and eval_table, so the
 * bytecode is read the same way whatever the JS functions look like.
 */

/** @typedef {[jsName: string, argCount: number, nagiName: string]} CommandEntry */

/** Action commands by opcode (0x00-0xB6). @type {CommandEntry[]} */
export const ACTIONS = [
    ["return",                  0, "return"],                   // 0 0x0
    ["increment",               1, "increment"],                // 1 0x1
    ["decrement",               1, "decrement"],                // 2 0x2
    ["assignn",                 2, "assignn"],                  // 3 0x3
    ["assignv",                 2, "assignv"],                  // 4 0x4
    ["addn",                    2, "addn"],                     // 5 0x5
    ["addv",                    2, "addv"],                     // 6 0x6
    ["subn",                    2, "subn"],                     // 7 0x7
    ["subv",                    2, "subv"],                     // 8 0x8
    ["lindirectv",              2, "lindirectv"],               // 9 0x9
    ["rindirect",               2, "rindirect"],                // 10 0xa
    ["lindirectn",              2, "lindirectn"],               // 11 0xb
    ["set",                     1, "set"],                      // 12 0xc
    ["reset",                   1, "reset"],                    // 13 0xd
    ["toggle",                  1, "toggle"],                   // 14 0xe
    ["set_v",                   1, "set.v"],                    // 15 0xf
    ["reset_v",                 1, "reset.v"],                  // 16 0x10
    ["toggle_v",                1, "toggle.v"],                 // 17 0x11
    ["new_room",                1, "new.room"],                 // 18 0x12
    ["new_room_v",              1, "new.room.v"],               // 19 0x13
    ["load_logic",              1, "load.logics"],              // 20 0x14
    ["load_logic_v",            1, "load.logics.v"],            // 21 0x15
    ["call",                    1, "call"],                     // 22 0x16
    ["call_v",                  1, "call.v"],                   // 23 0x17
    ["load_pic",                1, "load.pic"],                 // 24 0x18
    ["draw_pic",                1, "draw.pic"],                 // 25 0x19
    ["show_pic",                0, "show.pic"],                 // 26 0x1a
    ["discard_pic",             1, "discard.pic"],              // 27 0x1b
    ["overlay_pic",             1, "overlay.pic"],              // 28 0x1c
    ["show_pri_screen",         0, "show.priority.screen"],     // 29 0x1d
    ["load_view",               1, "load.view"],                // 30 0x1e
    ["load_view_v",             1, "load.view.v"],              // 31 0x1f
    ["discard_view",            1, "discard.view"],             // 32 0x20
    ["animate_obj",             1, "animate.object"],           // 33 0x21
    ["unanimate_all",           0, "unanimate.all"],            // 34 0x22
    ["draw",                    1, "draw"],                     // 35 0x23
    ["erase",                   1, "erase"],                    // 36 0x24
    ["position",                3, "position"],                 // 37 0x25
    ["position_v",              3, "position.v"],               // 38 0x26
    ["get_posn",                3, "get.position"],             // 39 0x27
    ["reposition",              3, "reposition"],               // 40 0x28
    ["set_view",                2, "set.view"],                 // 41 0x29
    ["set_view_v",              2, "set.view.v"],               // 42 0x2a
    ["set_loop",                2, "set.loop"],                 // 43 0x2b
    ["set_loop_v",              2, "set.loop.v"],               // 44 0x2c
    ["fix_loop",                1, "fix.loop"],                 // 45 0x2d
    ["release_loop",            1, "release.loop"],             // 46 0x2e
    ["set_cel",                 2, "set.cel"],                  // 47 0x2f
    ["set_cel_v",               2, "set.cel.v"],                // 48 0x30
    ["last_cel",                2, "last.cel"],                 // 49 0x31
    ["current_cel",             2, "current.cel"],              // 50 0x32
    ["current_loop",            2, "current.loop"],             // 51 0x33
    ["current_view",            2, "current.view"],             // 52 0x34
    ["number_of_loops",         2, "num.of.loops"],             // 53 0x35
    ["set_priority",            2, "set.priority"],             // 54 0x36
    ["set_priority_v",          2, "set.priority.v"],           // 55 0x37
    ["release_priority",        1, "release.priority"],         // 56 0x38
    ["get_priority",            2, "get.priority"],             // 57 0x39
    ["stop_update",             1, "stop.update"],              // 58 0x3a
    ["start_update",            1, "start.update"],             // 59 0x3b
    ["force_update",            1, "force.update"],             // 60 0x3c
    ["ignore_horizon",          1, "ignore.horizon"],           // 61 0x3d
    ["observe_horizon",         1, "observe.horizon"],          // 62 0x3e
    ["set_horizon",             1, "set.horizon"],              // 63 0x3f
    ["object_on_water",         1, "obj.on.water"],             // 64 0x40
    ["object_on_land",          1, "obj.on.land"],              // 65 0x41
    ["object_on_anything",      1, "obj.on.anything"],          // 66 0x42
    ["ignore_objs",             1, "ignore.objects"],           // 67 0x43
    ["observe_objs",            1, "observe.objects"],          // 68 0x44
    ["distance",                3, "distance"],                 // 69 0x45
    ["stop_cycling",            1, "stop.cycling"],             // 70 0x46
    ["start_cycling",           1, "start.cycling"],            // 71 0x47
    ["normal_cycle",            1, "normal.cycle"],             // 72 0x48
    ["end_of_loop",             2, "end.of.loop"],              // 73 0x49
    ["reverse_cycle",           1, "reverse.cycle"],            // 74 0x4a
    ["reverse_loop",            2, "reverse.loop"],             // 75 0x4b
    ["cycle_time",              2, "cycle.time"],               // 76 0x4c
    ["stop_motion",             1, "stop.motion"],              // 77 0x4d
    ["start_motion",            1, "start.motion"],             // 78 0x4e
    ["step_size",               2, "step.size"],                // 79 0x4f
    ["step_time",               2, "step.time"],                // 80 0x50
    ["move_obj",                5, "move.obj"],                 // 81 0x51
    ["move_obj_v",              5, "move.obj.v"],               // 82 0x52
    ["follow_ego",              3, "follow.ego"],               // 83 0x53
    ["wander",                  1, "wander"],                   // 84 0x54
    ["normal_motion",           1, "normal.motion"],            // 85 0x55
    ["set_dir",                 2, "set.dir"],                  // 86 0x56
    ["get_dir",                 2, "get.dir"],                  // 87 0x57
    ["ignore_blocks",           1, "ignore.blocks"],            // 88 0x58
    ["observe_blocks",          1, "observe.blocks"],           // 89 0x59
    ["block",                   4, "block"],                    // 90 0x5a
    ["unblock",                 0, "unblock"],                  // 91 0x5b
    ["get",                     1, "get"],                      // 92 0x5c
    ["get_v",                   1, "get.v"],                    // 93 0x5d
    ["drop",                    1, "drop"],                     // 94 0x5e
    ["put",                     2, "put"],                      // 95 0x5f
    ["put_v",                   2, "put.v"],                    // 96 0x60
    ["get_room_v",              2, "get.room.v"],               // 97 0x61
    ["load_sound",              1, "load.sound"],               // 98 0x62
    ["sound",                   2, "sound"],                    // 99 0x63
    ["stop_sound",              0, "stop.sound"],               // 100 0x64
    ["print",                   1, "print"],                    // 101 0x65
    ["print_v",                 1, "print.v"],                  // 102 0x66
    ["display",                 3, "display"],                  // 103 0x67
    ["display_v",               3, "display.v"],                // 104 0x68
    ["clear_lines",             3, "clear.lines"],              // 105 0x69
    ["text_screen",             0, "text.screen"],              // 106 0x6a
    ["graphics",                0, "graphics"],                 // 107 0x6b
    ["set_cursor_char",         1, "set.cursor.char"],          // 108 0x6c
    ["set_text_attribute",      2, "set.text.attrib"],          // 109 0x6d
    ["shake_screen",            1, "shake.screen"],             // 110 0x6e
    ["configure_screen",        3, "config.screen"],            // 111 0x6f
    ["status_line_on",          0, "status.line.on"],           // 112 0x70
    ["status_line_off",         0, "status.line.off"],          // 113 0x71
    ["set_string",              2, "set.string"],               // 114 0x72
    ["get_string",              5, "get.string"],               // 115 0x73
    ["word_to_string",          2, "word.to.string"],           // 116 0x74
    ["parse",                   1, "parse"],                    // 117 0x75
    ["get_num",                 2, "get.num"],                  // 118 0x76
    ["prevent_input",           0, "prevent.input"],            // 119 0x77
    ["accept_input",            0, "accept.input"],             // 120 0x78
    ["set_key",                 3, "set.key"],                  // 121 0x79
    ["add_to_pic",              7, "add.to.pic"],               // 122 0x7a
    ["add_to_pic_v",            7, "add.to.pic.v"],             // 123 0x7b
    ["status",                  0, "status"],                   // 124 0x7c
    ["save_game",               0, "save.game"],                // 125 0x7d
    ["restore_game",            0, "restore.game"],             // 126 0x7e
    ["init_disk",               0, "init.disk"],                // 127 0x7f
    ["restart_game",            0, "restart.game"],             // 128 0x80
    ["show_obj",                1, "show.obj"],                 // 129 0x81
    ["random",                  3, "random"],                   // 130 0x82
    ["program_control",         0, "program.control"],          // 131 0x83
    ["player_control",          0, "player.control"],           // 132 0x84
    ["obj_status_v",            1, "obj.status.v"],             // 133 0x85
    ["quit",                    1, "quit"],                     // 134 0x86
    ["show_mem",                0, "show.mem"],                 // 135 0x87
    ["pause",                   0, "pause"],                    // 136 0x88
    ["echo_line",               0, "echo.line"],                // 137 0x89
    ["cancel_line",             0, "cancel.line"],              // 138 0x8a
    ["init_joy",                0, "init.joy"],                 // 139 0x8b
    ["toggle_monitor",          0, "toggle.monitor"],           // 140 0x8c
    ["version",                 0, "version"],                  // 141 0x8d
    ["script_size",             1, "script.size"],              // 142 0x8e
    ["set_game_id",             1, "set.game.id"],              // 143 0x8f
    ["log",                     1, "log"],                      // 144 0x90
    ["set_scan_start",          0, "set.scan.start"],           // 145 0x91
    ["reset_scan_start",        0, "reset.scan.start"],         // 146 0x92
    ["reposition_to",           3, "reposition.to"],            // 147 0x93
    ["reposition_to_v",         3, "reposition.to.v"],          // 148 0x94
    ["trace_on",                0, "trace.on"],                 // 149 0x95
    ["trace_info",              3, "trace.info"],               // 150 0x96
    ["print_at",                4, "print.at"],                 // 151 0x97
    ["print_at_v",              4, "print.at.v"],               // 152 0x98
    ["discard_view_v",          1, "discard.view.v"],           // 153 0x99
    ["clear_text_rect",         5, "clear.text.rect"],          // 154 0x9a
    ["set_upper_left",          2, "set.upper.left"],           // 155 0x9b
    ["set_menu",                1, "set.menu"],                 // 156 0x9c
    ["set_menu_member",         2, "set.menu.item"],            // 157 0x9d
    ["submit_menu",             0, "submit.menu"],              // 158 0x9e
    ["enable_member",           1, "enable.item"],              // 159 0x9f
    ["disable_member",          1, "disable.item"],             // 160 0xa0
    ["menu_input",              0, "menu.input"],               // 161 0xa1
    ["show_obj_v",              1, "show.obj.v"],               // 162 0xa2
    ["open_dialogue",           0, "open.dialogue"],            // 163 0xa3
    ["close_dialogue",          0, "close.dialogue"],           // 164 0xa4
    ["mul_n",                   2, "mult.n"],                   // 165 0xa5
    ["mul_v",                   2, "mult.v"],                   // 166 0xa6
    ["div_n",                   2, "div.n"],                    // 167 0xa7
    ["div_v",                   2, "div.v"],                    // 168 0xa8
    ["close_window",            0, "close.window"],             // 169 0xa9
    ["set_simple",              1, "set.simple"],               // 170 0xaa
    ["push_script",             0, "push.script"],              // 171 0xab
    ["pop_script",              0, "pop.script"],               // 172 0xac
    ["hold_key",                0, "hold.key"],                 // 173 0xad
    ["set_pri_base",            1, "set.pri.base"],             // 174 0xae
    ["discard_sound",           1, "discard.sound"],            // 175 0xaf
    ["hide_mouse",              0, "hide.mouse"],               // 176 0xb0
    ["allow_menu",              1, "allow.menu"],               // 177 0xb1
    ["show_mouse",              0, "show.mouse"],               // 178 0xb2
    ["fence_mouse",             4, "fence.mouse"],              // 179 0xb3
    ["mouse_posn",              2, "mouse.posn"],               // 180 0xb4
    ["release_key",             0, "release.key"],              // 181 0xb5
    ["adj_ego_move_to_xy",      0, "adj.ego.move.to.x.y"],      // 182 0xb6
];

/**
 * Test commands by opcode (0x00-0x13). 0 and 19 don't exist in AGI v2 and are always false.
 * said (0x0E) has a variable number of arguments: a count byte, then 2 bytes per word group.
 * @type {CommandEntry[]}
 */
export const TESTS = [
    ["",                  0, "return.false"],     // 0 0x0
    ["equaln",            2, "equal.n"],          // 1 0x1
    ["equalv",            2, "equal.v"],          // 2 0x2
    ["lessn",             2, "less.n"],           // 3 0x3
    ["lessv",             2, "less.v"],           // 4 0x4
    ["greatern",          2, "greater.n"],        // 5 0x5
    ["greaterv",          2, "greater.v"],        // 6 0x6
    ["isset",             1, "isset"],            // 7 0x7
    ["issetv",            1, "isset.v"],          // 8 0x8
    ["has",               1, "has"],              // 9 0x9
    ["obj_in_room",       2, "obj.in.room"],      // 10 0xa
    ["posn",              5, "posn"],             // 11 0xb
    ["controller",        1, "controller"],       // 12 0xc
    ["have_key",          0, "have.key"],         // 13 0xd
    ["said",              0, "said"],             // 14 0xe
    ["compare_strings",   2, "compare.strings"],  // 15 0xf
    ["obj_in_box",        5, "obj.in.box"],       // 16 0x10
    ["center_posn",       5, "center.posn"],      // 17 0x11
    ["right_posn",        5, "right.posn"],       // 18 0x12
    ["",                  0, "unknown.19"],       // 19 0x13
];

export const SAID_OPCODE = 0x0E;
