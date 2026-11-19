export const DECRYPTION_KEY = "Avis Durgan";

export const palette = [
    0x000000,   // 0    BLACK
    0x0000AA,   // 1    DARK BLUE
    0x00AA00,   // 2    DARK GREEN
    0x00AAAA,   // 3    DARK CYAN
    0xAA0000,   // 4    DARK RED
    0xAA00AA,   // 5    DARK MAGENTA
    0xAA5500,   // 6    DARK BROWN
    0xAAAAAA,   // 7    GRAY
    0x555555,   // 8    DARK GRAY
    0x5555FF,   // 9    BLUE
    0x55FF55,   // 10   GREEN
    0x55FFFF,   // 11   CYAN
    0xFF5555,   // 12   RED
    0xFF55FF,   // 13   MAGENTA
    0xFFFF55,   // 14   YELLOW
    0xFFFFFF    // 15   WHITE
];

export const FLAG = {
    ego_on_water:             0,
    ego_hidden:               1,
    input_received:           2,
    ego_touching_signal_line: 3,
    input_parsed:             4,
    new_room:                 5,
    game_restarted:           6,
    script_buffer_blocked:    7,
    joystick_sensitivity_set: 8,
    sound_on:                 9,
    trace_enabled:            10,
    noise_enabled:            11,
    game_restored:            12,
    inventory_select_enabled: 13,
    menu_enabled:             14,
    windows_remain:           15,
    auto_restart:             16,
    auto_loop:                20
};

// http://agi.sierrahelp.com/AGIStudioHelp/Logic/SpecialVariables.html
export const VAR = {
    room_no:                 0,
    prev_room_no:            1,
    ego_edge_code:           2,
    score:                   3,
    object_touching_edge:    4,
    object_edge_code:        5,
    ego_dir:                 6,
    max_score:               7,
    free_memory:             8,
    unknown_word_no:         9,
    cycle_delay:             10,
    clock_seconds:           11,
    clock_minutes:           12,
    clock_hours:             13,
    clock_days:              14,
    joystick_sensitivity:    15,
    ego_view_no:             16,
    error_code:              17,
    error_information:       18,
    key_pressed:             19,
    computer_type:           20,
    window_close_time:       21,
    sound_channels:          22,
    sound_volume:            23,
    max_input_len:           24,
    selected_inventory_item: 25,
    video_mode:              26
};

// Command names and argument counts by opcode: see cmdTable.js.

export const AGI_RESOURCE_TYPE = {
    LOGIC: 0,
    PIC:   1,
    VIEW:  2,
    SOUND: 3
};

export const MAX_GAMEOBJECTS = 16;

// Corresponds to palette
export const GAMEOBJECT_PRIORITY = {
    UNCONDITIONAL_BARRIER: 0,   // BLACK
    CONDITIONAL_BARRIER:   1,   // DARK BLUE
    SIGNAL:                2,   // DARK GREEN
    WATER:                 3,   // DARK GREEN
    TOP:                   15,  // WHITE
};

export const SCREEN_WIDTH_PIXELS  = 320;

/**
 * Returned by a command when logic 0 must be restarted from the top in the same cycle
 * (new.room, restart.game). Execution of the current logic, and of every logic that
 * called it, stops right away. NAGI does the same by returning a null code pointer
 * (new_room.c, state_io.c, logic/logic_base.c: cmd_call).
 */
export const RESTART_LOGIC_0 = Symbol('restart logic 0');
