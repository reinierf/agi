// Portions ported from NAGI (c) 2001-2002 Nick Sonneveld, X11 license, see licenses/NAGI-LICENSE.txt
// (logic/logic_execute.c)
import {AGI_RESOURCE_TYPE, DECRYPTION_KEY, RESTART_LOGIC_0, VAR} from './constants';
import {readAgiResource} from './resources';
import {commands} from './logicCommands';
import {ACTIONS, SAID_OPCODE, TESTS} from './cmdTable';
import {isStub, reportUnimplemented} from './diagnostics';
import {state} from './state';

/**
 * True for the iterator a generator command returns (a command that may wait).
 * @param {any} value
 */
const isIterator = value => value !== null && typeof value === 'object' && typeof value.next === 'function';

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
     *
     * A generator: a command that waits for the player (a message window) is a generator
     * as well, and its yields pass through here to the game loop (see wait.js). The logic
     * then carries on from the same place, as in NAGI, where the command blocks.
     * @returns {Generator<void, symbol|undefined, void>} returns RESTART_LOGIC_0 if a
     *   command asked for logic 0 to be restarted
     */
    *parseLogic() {
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
                    yield* this.executeIf();
                    break;
                case 0xFE: // goto
                    const labelAddress = data.readInt16();
                    this.jumpRel(labelAddress);
                    break;
                default: {
                    // NAGI logic/logic_execute.c: logic_cmd()
                    if (opCodeNr >= ACTIONS.length) {
                        console.log(this.no, data.position);
                        throw `Unknown action [0x${opCodeNr.toString(16)}] in logic ${this.no}`;
                    }

                    const [funcName, argCount] = ACTIONS[opCodeNr];

                    const actionFuncArgs = [];
                    for (let i = 0; i < argCount; i++) {
                        actionFuncArgs.push(data.readUint8());
                    }

                    const actionFunc = commands["agi_" + funcName];
                    if (actionFunc === undefined) {
                        // Like NAGI for commands it doesn't implement: skip the arguments
                        // and carry on.
                        reportUnimplemented('action', opCodeNr, this.no, state.variables[VAR.room_no]);
                        break;
                    }
                    if (isStub(funcName)) {
                        reportUnimplemented('stub', opCodeNr, this.no, state.variables[VAR.room_no]);
                    }

                    // new.room, restart.game and call (of a logic that did one of those)
                    // stop this logic; the main cycle then restarts logic 0.
                    let result = actionFunc.apply(null, actionFuncArgs);
                    if (isIterator(result)) {
                        result = yield* result;
                    }
                    if (result === RESTART_LOGIC_0) {
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
     * A generator, as a test may pause the logic (have.key; see Logic.parseLogic()).
     * NAGI logic/logic_execute.c: execute_if()
     * @returns {Generator<void, void, void>}
     */
    *executeIf() {
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
                let test = this.evalTest(op);
                if (isIterator(test)) test = yield* test; // have.key lets keys arrive
                const result = !!test !== notMode;
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
        if (op === SAID_OPCODE) { // said: a count byte, then 2 bytes per word group
            const count = this.data.readUint8();
            this.data.position += count * 2;
        } else {
            this.data.position += TESTS[op]?.[1] ?? 0;
        }
    }

    /**
     * Runs one test command and returns its result.
     * NAGI logic/logic_execute.c: logic_eval()
     * @param {number} op test opcode
     * @returns {any} the result (truthy or falsy), or an iterator for a test that may
     *   pause the logic (have.key), whose return value is the result
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

        const [funcName, argCount] = TESTS[op];
        const testFunc = commands["agi_test_" + funcName];
        if (testFunc === undefined) {
            reportUnimplemented('test', op, this.no, state.variables[VAR.room_no]);
            this.skipTestArgs(op);
            return false;
        }

        const args = [];
        if (op === SAID_OPCODE) {
            const count = data.readUint8();
            for (let i = 0; i < count; i++) {
                args.push(data.readUint16());
            }
        } else {
            for (let i = 0; i < argCount; i++) {
                args.push(data.readUint8());
            }
        }

        return testFunc.apply(null, args);
    }
}

