import {
    FLAG,
    GAMEOBJECT_DIRECTION,
    GAMEOBJECT_MAX_Y,
    GAMEOBJECT_MOVE_FLAGS,
    GAMEOBJECT_PRIORITY,
    MAX_GAMEOBJECTS, SCREEN_WIDTH_UNITS,
    RESTART_LOGIC_0,
    VAR
} from './constants';
import {Bitmap} from './bitmap';
import screen from './screen';
import {commands} from './logicCommands';
import SoundEmulatorTiSn76496a from './soundEmulator';
import {randomBetween} from './helpers';
import {state, resetControllers, restart, updateSound} from './state';
import playerSaveSystem from './playerSaveSystem';
import playerCommandSystem from './playerCommandSystem';
import {setObjDirectionViaMoveTo} from './gameObject';
import {eventsInit} from './events';
import {inputPoll} from './input';
import {checkCommandTable} from './diagnostics';

let canvasContext;
let audioContext;

const bltFrame = () => canvasContext.putImageData(state.frameData, 0, 0);
const bltDebug = () => {
    const c  = document.createElement('canvas');
    c.width  = 320;
    c.height = 200;
    c.getContext('2d').putImageData(state.debugFrameData, 0, 0);
    const imageEl   = document.createElement('img');
    imageEl.src     = c.toDataURL();
    imageEl.onclick = e => e.target.parentElement.removeChild(e.target);
    document.getElementById('debug').appendChild(imageEl);
};

const init = (_canvasContext, _audioContext, _menuContainerElement, _actionContainerElement, _actionSearchElement) => {
    if (canvasContext) return;

    canvasContext                = _canvasContext;
    audioContext                 = _audioContext;
    state.menuContainerElement   = _menuContainerElement;
    state.actionContainerElement = _actionContainerElement;
    state.actionSearchElement    = _actionSearchElement;

    state.visualBuffer         = new Bitmap();
    state.visualPriorityBuffer = new Bitmap();
    state.priorityBuffer       = new Bitmap();
    state.framePriorityData    = new Bitmap();
    state.frameData            = canvasContext.createImageData(320, 200);
    state.debugFrameData       = canvasContext.createImageData(320, 200);

    state.soundEmulator = new SoundEmulatorTiSn76496a(_audioContext);

    screen.init(state);

    _actionSearchElement.onkeydown  = e => e.stopPropagation();
    _actionSearchElement.onkeypress = e => e.stopPropagation();
    _actionSearchElement.onkeyup    = () => playerCommandSystem.searchSaidSystem();

    eventsInit(window);
    checkCommandTable(commands);

    restart();
};

const updateScore = () => {
    const scoreEl = document.getElementById('score');
    if (!scoreEl) return;

    scoreEl.innerHTML = `Score: ${state.variables[VAR.score]} / ${state.variables[VAR.max_score]}`;
}

const getObjBaselinesTouching = (o1, o2, dx = 0, dy = 0) => {
    if (o1.y + dy !== o2.y) return false;

    const o1View = state.loadedViews[o1.viewNo];
    const o1Cel  = o1View.loops[o1.loop].cels[o1.cel];

    const o2View = state.loadedViews[o2.viewNo];
    const o2Cel  = o2View.loops[o2.loop].cels[o2.cel];

    const finalO1XStart = o1.x + dx;
    const finalO1XEnd   = o1.x + dx + o1Cel.width;

    const finalO2XStart = o2.x;
    const finalO2XEnd   = o2.x + o2Cel.width;

    return (
        (finalO1XStart >= finalO2XStart && finalO1XEnd <= finalO2XEnd) ||       // O1 entirely inside O2
        (finalO1XStart < finalO2XStart && finalO1XEnd >= finalO1XStart) ||      // O1 touching O2 from left
        (finalO1XStart > finalO2XStart && finalO1XStart <= finalO2XStart) ||    // O1 touching O2 from right
        (finalO2XStart >= finalO1XStart && finalO2XEnd <= finalO1XEnd)          // O2 entirely inside O1
    );
};

// http://agi.sierrahelp.com/AGIStudioHelp/ObjectsViews/ControllingObstacles.html
const getNewXYForObjectAccountForBlocks = (obj, no, newX, newY) => {
    const view         = state.loadedViews[obj.viewNo];
    const cel          = view.loops[obj.loop].cels[obj.cel];
    const priorityData = state.priorityBuffer.data;

    let shouldMove       = true;
    let hasHitSignalLine = false;
    let isEgoOnWater     = no === 0;

    // Reached edges of the screen
    if (newY > GAMEOBJECT_MAX_Y || newY < 0 || newX < 0 || newX > 160) {
        shouldMove = false;
    }

    if (shouldMove) {
        // Hit the horizon
        if (!obj.ignoreHorizon) {
            shouldMove &&= newY >= state.horizon;
        }

        for (let i = 0; i < cel.width; i++) {
            if (!shouldMove) break;

            const nextPositionPriority = priorityData[newY * 160 + newX + i];

            // Out of range
            if (nextPositionPriority === undefined) {
                continue;
            }

            shouldMove &&= nextPositionPriority !== GAMEOBJECT_PRIORITY.UNCONDITIONAL_BARRIER;

            if (!obj.ignoreBlocks && nextPositionPriority === GAMEOBJECT_PRIORITY.CONDITIONAL_BARRIER) {
                shouldMove = false;
            }
        }
    }

    // Check for collisions with other GameObjects
    if (shouldMove && !obj.ignoreObjs) {
        for (let i = 0; i < MAX_GAMEOBJECTS; i++) {
            if (i === no) continue;

            const otherObj = state.gameObjects[i];

            // Only check if the objects are being drawn
            if (otherObj.draw) {
                const isTouching = getObjBaselinesTouching(obj, otherObj, newX - obj.x, newY - obj.y);

                if (isTouching && !otherObj.ignoreObjs) {
                    shouldMove = false;
                    break;
                }
            }
        }
    }

    // Hit a stop somewhere
    if (!shouldMove) {
        newX = obj.x;
        newY = obj.y;

        obj.direction = GAMEOBJECT_DIRECTION.Stopped;

        if (obj.movementFlag === GAMEOBJECT_MOVE_FLAGS.Wander) {
            obj.direction = randomBetween(1, 9);
        }

        if (no === 0) {
            state.variables[VAR.ego_dir] = obj.direction;
        }
    }

    if (no === 0) {
        for (let i = 0; i < cel.width; i++) {
            const nextPositionPriority = priorityData[newY * 160 + newX + i];

            // Out of range
            if (nextPositionPriority === undefined) {
                continue;
            }

            // Hit a signal line
            hasHitSignalLine ||= nextPositionPriority === GAMEOBJECT_PRIORITY.SIGNAL;

            // Is entirely within water
            isEgoOnWater &&= nextPositionPriority === GAMEOBJECT_PRIORITY.WATER;
        }

        if (hasHitSignalLine) {
            commands.agi_set(FLAG.ego_touching_signal_line);
        } else {
            commands.agi_reset(FLAG.ego_touching_signal_line);
        }

        if (isEgoOnWater) {
            commands.agi_set(FLAG.ego_on_water);
        } else {
            commands.agi_reset(FLAG.ego_on_water);
        }
    }

    return [newX, newY];
}

const updateObject = (obj, no) => {
    if (obj.update) {
        let hasChangedDirection = false;

        const view = state.loadedViews[obj.viewNo];

        // View has to be loaded before we attempt to update
        if (!view) return;

        const cel = view.loops[obj.loop].cels[obj.cel];

        obj.oldX = obj.x;
        obj.oldY = obj.y;

        let xStep = obj.stepSize;
        let yStep = obj.stepSize;
        switch (obj.movementFlag) {
            case GAMEOBJECT_MOVE_FLAGS.Normal:
                break;
            case GAMEOBJECT_MOVE_FLAGS.MoveTo:
                if (obj.moveToStep !== 0) {
                    xStep = yStep = obj.moveToStep;
                }

                yStep = Math.min(yStep, Math.abs(obj.y - obj.moveToY));
                xStep = Math.min(xStep, Math.abs(obj.x - obj.moveToX));

                if (view.loops.length < 5) {
                    setObjDirectionViaMoveTo(obj);
                }

                break;
            case GAMEOBJECT_MOVE_FLAGS.ChaseEgo:
                const egoX = state.gameObjects[0].x;
                const egoY = state.gameObjects[0].y;
                if (egoX > obj.x) {
                    if (egoY > obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.DownRight;
                    } else if (egoY < obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.UpRight;
                    } else {
                        obj.direction = GAMEOBJECT_DIRECTION.Right;
                    }
                } else if (egoX < obj.x) {
                    if (egoY > obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.DownLeft;
                    } else if (egoY < obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.UpLeft;
                    } else {
                        obj.direction = GAMEOBJECT_DIRECTION.Left;
                    }
                } else {
                    if (egoY > obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.Down;
                    } else if (egoY < obj.y) {
                        obj.direction = GAMEOBJECT_DIRECTION.Up;
                    }
                }

                yStep = Math.min(yStep, Math.abs(obj.y - egoY));
                xStep = Math.min(xStep, Math.abs(obj.x - egoX));
                break;

            case GAMEOBJECT_MOVE_FLAGS.Wander:
                break;
            default:
        }
        let newX = obj.x;
        let newY = obj.y;
        if (obj.direction === 1 || obj.direction === 2 || obj.direction === 8) {
            newY = obj.y - yStep;
        } else if (obj.direction === 5 || obj.direction === 4 || obj.direction === 6) {
            newY = obj.y + yStep;
        }

        if (obj.direction === 7 || obj.direction === 8 || obj.direction === 6) {
            newX = obj.x - xStep;
        } else if (obj.direction === 3 || obj.direction === 2 || obj.direction === 4) {
            newX = obj.x + xStep;
        }

        // Set newX, newY based on blocks, but only if it's not a MoveTo
        if (obj.movementFlag !== GAMEOBJECT_MOVE_FLAGS.MoveTo) {
            [newX, newY] = getNewXYForObjectAccountForBlocks(obj, no, newX, newY);
        }

        if (obj.stepTimeUntilNextStep > 0) {
            obj.stepTimeUntilNextStep--;
        } else {
            obj.x                     = newX;
            obj.y                     = newY;
            obj.stepTimeUntilNextStep = obj.stepTime;
        }

        // Enforce horizon
        if (!obj.ignoreHorizon && obj.y < state.horizon) {
            obj.y = state.horizon + 1;
        }

        if (obj.movementFlag === GAMEOBJECT_MOVE_FLAGS.MoveTo && obj.x === obj.moveToX && obj.y === obj.moveToY) {
            obj.direction = GAMEOBJECT_DIRECTION.Stopped;
            commands.agi_set(obj.flagToSetWhenFinished);
            obj.movementFlag = GAMEOBJECT_MOVE_FLAGS.Normal;
        }

        if (obj.x !== obj.oldX || obj.y !== obj.oldY) {
            if (obj.x <= 0) {
                if (no === 0) {
                    state.variables[VAR.ego_edge_code] = 4;
                } else {
                    state.variables[VAR.object_touching_edge] = no;
                    state.variables[VAR.object_edge_code]     = 4;
                }
            } else if (cel && (obj.x + cel.width >= SCREEN_WIDTH_UNITS)) {
                if (no === 0) {
                    state.variables[VAR.ego_edge_code] = 2;
                } else {
                    state.variables[VAR.object_touching_edge] = no;
                    state.variables[VAR.object_edge_code]     = 2;
                }
            } else if (!obj.ignoreHorizon && obj.y <= state.horizon) {
                if (no === 0) {
                    state.variables[VAR.ego_edge_code] = 1;
                } else {
                    state.variables[VAR.object_touching_edge] = no;
                    state.variables[VAR.object_edge_code]     = 1;
                }
            } else if (obj.y >= GAMEOBJECT_MAX_Y) {
                if (no === 0) {
                    state.variables[VAR.ego_edge_code] = 3;
                } else {
                    state.variables[VAR.object_touching_edge] = no;
                    state.variables[VAR.object_edge_code]     = 3;
                }
            } else {
                // Not touching any edges
                if (no === 0) {
                    state.variables[VAR.ego_edge_code] = 0;
                } else {
                    state.variables[VAR.object_edge_code] = 0;
                }
            }
        }

        if (!obj.fixedLoop) {
            if (view.loops.length > 1 && view.loops.length < 4) {
                // http://agi.sierrahelp.com/AGIStudioHelp/ObjectsViews/CyclingObjects.html

                if (obj.direction === GAMEOBJECT_DIRECTION.Up && view.loops[2] && view.loops[3]) {
                    obj.loop            = 3;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (
                    obj.direction === GAMEOBJECT_DIRECTION.UpRight ||
                    obj.direction === GAMEOBJECT_DIRECTION.Right ||
                    obj.direction === GAMEOBJECT_DIRECTION.DownRight
                ) {
                    obj.loop            = 0;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (obj.direction === GAMEOBJECT_DIRECTION.Down && view.loops[2] && view.loops[3]) {
                    obj.loop            = 2;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (
                    obj.direction === GAMEOBJECT_DIRECTION.DownLeft ||
                    obj.direction === GAMEOBJECT_DIRECTION.Left ||
                    obj.direction === GAMEOBJECT_DIRECTION.UpLeft
                ) {
                    if (view.loops[1]) {
                        obj.loop = 1;
                    } else {
                        obj.loop = 0;
                    }
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                }

                // Ensure we force the correct cel for the new loop if it's changed direction
                if (hasChangedDirection) {
                    obj.nextCycle = 1;
                }
            } else if (view.loops.length >= 4) {
                if (obj.direction === 1) {
                    obj.loop            = 3;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (obj.direction === 2 || obj.direction === 3 || obj.direction === 4) {
                    obj.loop            = 0;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (obj.direction === 5) {
                    obj.loop            = 2;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                } else if (obj.direction === 6 || obj.direction === 7 || obj.direction === 8) {
                    obj.loop            = 1;
                    hasChangedDirection = obj.loop !== obj.oldLoop;
                }

                // Ensure we force the correct cel for the new loop if it's changed direction
                if (hasChangedDirection) {
                    obj.nextCycle = 1;
                }
            }
        }

        if (obj.celCycling) {
            if (obj.nextCycle === 1) {
                if (obj.reverseCycle) {
                    obj.cel--;
                } else {
                    obj.cel++;
                }

                let endOfLoop = false;
                if (obj.cel < 0) {
                    if (obj.callAtEndOfLoop) {
                        obj.cel = 0;
                    } else {
                        obj.cel = view.loops[obj.loop].cels.length - 1;
                    }
                    endOfLoop = true;
                } else if (obj.cel > view.loops[obj.loop].cels.length - 1) {
                    if (obj.callAtEndOfLoop) {
                        obj.cel = view.loops[obj.loop].cels.length - 1;
                    } else {
                        obj.cel = 0;
                    }
                    endOfLoop = true;
                }

                if (endOfLoop && obj.callAtEndOfLoop) {
                    obj.celCycling = false;
                    commands.agi_set(obj.flagToSetWhenFinished);
                }
                obj.nextCycle = obj.cycleTime;
            } else {
                obj.nextCycle--;
            }
        }
    }

    if (obj.draw) {
        if (!obj.fixedPriority) {
            // http://agi.sierrahelp.com/AGIStudioHelp/Picture/Priorities.html
            if (obj.y < 48) {
                obj.priority = 4;
            } else if (obj.y < 60) {
                obj.priority = 5;
            } else if (obj.y < 72) {
                obj.priority = 6;
            } else if (obj.y < 84) {
                obj.priority = 7;
            } else if (obj.y < 96) {
                obj.priority = 8;
            } else if (obj.y < 108) {
                obj.priority = 9;
            } else if (obj.y < 120) {
                obj.priority = 10;
            } else if (obj.y < 132) {
                obj.priority = 11;
            } else if (obj.y < 144) {
                obj.priority = 12;
            } else if (obj.y < 156) {
                obj.priority = 13;
            } else if (obj.y <= GAMEOBJECT_MAX_Y) {
                obj.priority = 14;
            } else {
                obj.priority = 15;
            }
        }

        screen.drawObject(obj);
    }
}

function updateInterpreterClock() {
    const now = new Date();

    // Probably not right
    // todo: track time?
    state.variables[VAR.clock_seconds] = now.getSeconds();
    state.variables[VAR.clock_minutes] = now.getMinutes();
    state.variables[VAR.clock_hours]   = now.getHours();
}

/**
 * Step 1 of a cycle (NAGI nagi_main.c, main loop): reset the input state. In NAGI this
 * happens before do_delay(), which polls input while it waits.
 */
const beginCycle = () => {
    resetControllers();
    commands.agi_reset(FLAG.input_received);  // player has not entered a command
    commands.agi_reset(FLAG.input_parsed);    // said() has not accepted the input yet
    state.variables[VAR.key_pressed]     = 0;
    state.variables[VAR.unknown_word_no] = 0;
};

/**
 * Steps 3-7 of a cycle (NAGI nagi_main.c, main loop), run after the delay and input poll.
 */
const runCycle = () => {
    updateInterpreterClock();
    playerSaveSystem.handleSaveRestore();

    const ego = state.gameObjects[0];

    // Ego direction: under program control the logic reads ego's direction from v6;
    // under player control v6 (set by the arrow keys) steers ego.
    if (state.programControl) {
        state.variables[VAR.ego_dir] = ego.direction;
    } else {
        ego.direction = state.variables[VAR.ego_dir];
    }

    // new.room / restart.game stop logic 0, which then runs again from the top in the
    // same cycle.
    while (commands.agi_call(0) === RESTART_LOGIC_0) {
        state.variables[VAR.unknown_word_no]      = 0;
        state.variables[VAR.object_edge_code]     = 0;
        state.variables[VAR.object_touching_edge] = 0;
        commands.agi_reset(FLAG.input_received);
    }

    ego.direction = state.variables[VAR.ego_dir];

    // NAGI redraws the status line here only if the score or the sound flag changed.
    // The score is still shown in HTML (cheap to refresh) until Phase 3 draws the status line.
    updateScore();

    state.variables[VAR.object_edge_code]     = 0;
    state.variables[VAR.object_touching_edge] = 0;
    commands.agi_reset(FLAG.new_room);
    commands.agi_reset(FLAG.game_restarted);
    commands.agi_reset(FLAG.game_restored);

    // NAGI skips this in text mode (text.screen); that check belongs to Phase 3.
    // Reverse the rendering of objects so that ego might always be drawn on top of anything!
    for (let j = state.gameObjects.length - 1; j >= 0; j--) {
        updateObject(state.gameObjects[j], j);
    }

    bltFrame();
    playerCommandSystem.updateSaidSystem();
    updateSound();
};

/** One interpreter cycle without the delay (for scripted use from the console). */
const cycle = () => {
    beginCycle();
    inputPoll();
    runCycle();
};

export default {
    bltDebug,
    init,
    beginCycle,
    inputPoll,
    runCycle,
    cycle,
}
