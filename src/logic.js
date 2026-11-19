// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (logic/logic_execute.c, logic/cmd_table.c)
import {AGI_RESOURCE_TYPE, DECRYPTION_KEY, LOGIC_ACTIONS, LOGIC_TESTS, RESTART_LOGIC_0} from './constants';
import {readAgiResource} from './resources';
import {commands} from './logicCommands';

/**
 * Number of argument bytes of each test command, by opcode. said (0x0E) has a variable
 * number. From eval_table in NAGI logic/cmd_table.c.
 */
const TEST_ARG_COUNTS = [
    0, // 0x00 return.false
    2, 2, 2, 2, 2, 2, // equal.n, equal.v, less.n, less.v, greater.n, greater.v
    1, 1, 1, // isset, isset.v, has
    2, // obj.in.room
    5, // posn
    1, // controller
    0, // have.key
    0, // said (variable)
    2, // compare.strings
    5, 5, 5, // obj.in.box, center.posn, right.posn
    0, // 0x13 unknown
];

export default class Logic {
    /** @type ByteBuffer */
    data       = null;
    scanStart  = 0;
    no         = 0;
    messages   = [];
    entryPoint = 0;

    constructor(_no) {
        this.no = _no;
        this.load();
    }

    load() {
        this.data           = readAgiResource(AGI_RESOURCE_TYPE.LOGIC, this.no);
        const messageOffset = this.data.readUint16();
        this.data.position += messageOffset; // Jump to messages

        const pos                = this.data.position;
        this.messagesStartOffset = pos;

        const numMessages    = this.data.readUint8();
        const ptrMessagesEnd = this.data.readUint16();

        let decryptionIndex = 0;
        for (let i = 0; i < numMessages; i++) {
            let msgPtr = this.data.readUint16();
            if (msgPtr === 0) {
                continue;
            }
            let messagePosition = this.data.position;
            this.data.position  = pos + msgPtr + 1;
            let msg             = '';
            while (true) {
                let decrypted = String.fromCharCode(
                    DECRYPTION_KEY[decryptionIndex++].charCodeAt(0) ^ this.data.readUint8()
                );

                if (decryptionIndex >= DECRYPTION_KEY.length) {
                    decryptionIndex = 0;
                }

                if (decrypted === '\0') {
                    break;
                }

                msg += decrypted;
            }
            this.messages[i + 1] = msg;
            this.data.position   = messagePosition;
        }
        this.data.position = pos - messageOffset;
        this.scanStart     = this.entryPoint = this.data.position;
    }

    jumpRel(offset) {
        this.data.position += offset;
    }

    log(args) {
        console.log(this.no, args);
    }

    /**
     * Runs the logic from its scan start until `return`.
     * Port of logic_execute() and logic_cmd() in NAGI logic/logic_execute.c (_LogicExecute,
     * _LogicCmd). set.scan.start and reset.scan.start are handled here as in jsyang's code.
     * @returns {symbol|undefined} RESTART_LOGIC_0 if a command asked for logic 0 to be restarted.
     */
    parseLogic() {
        const data    = this.data;
        data.position = this.scanStart;

        while (data.position <= this.messagesStartOffset) {
            /** @type number */
            const opCodeNr = data.readUint8();

            switch (opCodeNr) {
                case 0x00: // return
                    return;
                case 0x91:
                    // set.scan.start
                    this.scanStart = data.position;
                    break;
                case 0x92:
                    // reset.scan.start
                    this.scanStart = this.entryPoint;
                    break;
                case 0xFF: // if
                    this.executeIf();
                    break;
                case 0xFE: // goto
                    const labelAddress = data.readInt16();
                    this.jumpRel(labelAddress);
                    break;
                default: {
                    const funcName = LOGIC_ACTIONS[opCodeNr] || 'UNKNOWN';

                    let actionFunc = commands["agi_" + funcName];
                    if (actionFunc === undefined) {
                        console.log(this.no, data.position);
                        throw `Action not implemented: ${funcName} [0x${opCodeNr.toString(16)}]`;
                    }

                    const actionFuncArgs = [];
                    for (let i = 0; i < actionFunc.length; i++) {
                        actionFuncArgs.push(data.readUint8());
                    }

                    // new.room, restart.game and call (of a logic that did one of those)
                    // stop this logic; the main cycle then restarts logic 0.
                    if (actionFunc.apply(null, actionFuncArgs) === RESTART_LOGIC_0) {
                        return RESTART_LOGIC_0;
                    }
                    break;
                }
            }
        }
    }

    /**
     * Evaluates the conditions of an `if` (the 0xFF has been read) and leaves the read
     * position at the start of the if's body when true, or after it when false.
     * Tests run left to right and stop as soon as the outcome is known, so side effects
     * (said() setting flag 4, have.key reading a key) happen exactly as in AGI.
     *
     * NAGI logic/logic_execute.c: execute_if()
     */
    executeIf() {
        const data  = this.data;
        let notMode = false;
        let orMode  = false;

        for (;;) {
            const op = data.readUint8();

            if (op >= 0xFC && op !== 0xFE) {
                if (op === 0xFC) { // or bracket
                    // Reaching the end of an "or" bracket without a true test: the if is false.
                    if (orMode) {
                        this.skipFalseAnd();
                        return;
                    }
                    orMode = true;
                } else if (op === 0xFF) { // end of the conditions: true
                    data.position += 2; // skip the else offset
                    return;
                } else { // 0xFD: not
                    notMode = !notMode;
                }
            } else {
                const result = this.evalTest(op) !== notMode;
                notMode      = false;

                if (result) {
                    if (orMode) {
                        orMode = false;
                        this.skipTrueOr();
                    }
                } else if (!orMode) {
                    this.skipFalseAnd();
                    return;
                }
            }
        }
    }

    /**
     * A test in an "or" bracket was true: skip the rest of the bracket.
     * NAGI logic/logic_execute.c: skip_true_or()
     */
    skipTrueOr() {
        const data = this.data;
        let op     = data.readUint8();

        while (op !== 0xFC) {
            if (op < 0xFC) this.skipTestArgs(op);
            op = data.readUint8();
        }
    }

    /**
     * A test outside an "or" bracket was false: skip to the end of the conditions, then
     * jump over the if's body.
     * NAGI logic/logic_execute.c: skip_false_and()
     */
    skipFalseAnd() {
        const data = this.data;
        let op     = data.readUint8();

        while (op !== 0xFF) {
            if (op < 0xFC) this.skipTestArgs(op);
            op = data.readUint8();
        }

        const elseOffset = data.readUint16();
        data.position += elseOffset;
    }

    /** @param {number} op test opcode whose argument bytes to skip */
    skipTestArgs(op) {
        if (op === 0x0E) { // said: a count byte, then 2 bytes per word group
            const count = this.data.readUint8();
            this.data.position += count * 2;
        } else {
            this.data.position += TEST_ARG_COUNTS[op] ?? 0;
        }
    }

    /**
     * Runs one test command and returns its result.
     * NAGI logic/logic_execute.c: logic_eval()
     * @param {number} op test opcode
     * @returns {boolean}
     */
    evalTest(op) {
        const data = this.data;

        if (op > 19) {
            console.log(this.no, data.position);
            throw `Test not implemented: [0x${op.toString(16)}]`;
        }

        // 0 and 19 have no test in AGI v2: NAGI returns false (cmd_ret_false).
        if (op === 0 || op === 19) {
            return false;
        }

        const funcName = LOGIC_TESTS[op - 1];
        const testFunc = commands["agi_test_" + funcName];
        if (testFunc === undefined) {
            console.log(this.no, data.position);
            throw `Test not implemented: ${funcName} [0x${op.toString(16)}]`;
        }

        const args = [];
        if (op === 0x0E) { // said
            const count = data.readUint8();
            for (let i = 0; i < count; i++) {
                args.push(data.readUint16());
            }
        } else {
            for (let i = 0; i < TEST_ARG_COUNTS[op]; i++) {
                args.push(data.readUint8());
            }
        }

        return !!testFunc.apply(null, args);
    }
}

