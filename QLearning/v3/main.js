/******************************************************************************
 *  main.js — Q-learning with persistence and epoch resets
 *  ---------------------------------------------------------------
 *  This main loop trains a Q-table that decides which creep body/role
 *  to spawn (or to WAIT) under a 3-bit room state.
 *
 *  Key features
 *  ------------
 *  • All *exact* 3-part body permutations of {WORK,CARRY,MOVE} are explored.
 *  • One epoch lasts until the room hits RCL 2.
 *  • At the end of an epoch the Q-table is saved to *segment 0* and a compact
 *    metrics summary to *segment 1*, then the script sets `Memory.wantReset`
 *    so an external watcher can trigger `resetUser`.
 *  • During the epoch the loop auto-logs progress every `SAVE_EACH` ticks.
 ******************************************************************************/

const SEG_ID = 0; // Q-table segment ID
const METRICS_SEG = 1; // Metrics segment ID
const SAVE_EACH = 100;

function generateExactBodyCombos(parts, maxParts) {
  const combos = [];
  function helper(prefix, depth) {
    if (depth === maxParts) {
      combos.push(prefix.slice());
      return;
    }
    for (const p of parts) {
      prefix.push(p);
      helper(prefix, depth + 1);
      prefix.pop();
    }
  }
  helper([], 0);
  return combos;
}

const ALL_BODIES = generateExactBodyCombos([WORK, CARRY, MOVE], 3);
const brain = require("qlearning");
const creepLogic = require("creep");

const ROLES = ["harvester", "upgrader"];
const ACTIONS = [];
for (const body of ALL_BODIES) {
  for (const role of ROLES) {
    ACTIONS.push({ type: "SPAWN", role, body });
  }
}
ACTIONS.push({ type: "WAIT" });

function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(
    (r) => r.controller && r.controller.my
  );
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] reset, Q-learning relaunched");
}
if (!Memory.evaluation) {
  Memory.evaluation = {
    startTick: Game.time,
    actionsTaken: 0,
    history: [],
  };
}

function state(room) {
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.some(Game.creeps, (c) => c.memory.role === "harvester") ? 1 : 0;
  const u = _.some(Game.creeps, (c) => c.memory.role === "upgrader") ? 1 : 0;
  return `${e}${h}${u}`;
}

module.exports.loop = function () {
  if (Memory.wantReset) {
    if (Game.time % 20 === 0) console.log("[EPOCH] waiting for resetUser...");
    return;
  }

  // Load Q-table from segment 0
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        const parsed = JSON.parse(seg);
        Memory.brain = parsed.brain;
        Memory.brainLoaded = true;
        console.log(
          `[PERSIST] Q-table restored |Q|=${Object.keys(parsed.brain.q).length}`
        );
      } catch (e) {
        console.log("[PERSIST] parse error (corrupted):", e);
      }
    }
    RawMemory.setActiveSegments([]);
  }

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  // Epoch reset logic
  if (room.controller.level >= 2 && !Memory.wantReset) {
    // Save Q-table and metrics
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });

    RawMemory.setActiveSegments([METRICS_SEG]);
    RawMemory.segments[METRICS_SEG] = JSON.stringify(Memory.evaluation);

    // Build summary metrics
    const hist = Memory.evaluation.history;
    const summary = {
      startTick: Memory.evaluation.startTick,
      actionsTaken: Memory.evaluation.actionsTaken,
      historyCount: hist.length,
      controllerLevel: room.controller.level,
      firstEntry: hist[0],
      lastEntry: {
        tick: Game.time,
        controllerLevel: room.controller.level,
        controllerProgress: room.controller.progress,
        harvester: _.countBy(Game.creeps, (c) => c.memory.role).harvester || 0,
        upgrader: _.countBy(Game.creeps, (c) => c.memory.role).upgrader || 0,
      },
    };
    console.log("[METRICS]", JSON.stringify(summary));

    // Clear metrics segment after saving <100kB
    RawMemory.segments[METRICS_SEG] = "";

    // Desactivate segments
    RawMemory.setActiveSegments([]);

    // Reset Memory for next epoch
    delete Memory.evaluation;
    Memory.wantReset = true;
    console.log(
      "[EPOCH] RCL2 reached, Q-table and metrics saved, waiting for reset"
    );
    return;
  }

  // Q-learning logic
  const S = state(room);
  const A = brain.act(S, ACTIONS);
  Memory.evaluation.actionsTaken++;

  // Execute action
  if (A.type === "SPAWN") {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawn.spawnCreep(A.body, `${A.role[0].toUpperCase()}${Game.time}`, {
        memory: { role: A.role },
      });
    }
  }

  // Creeps logic execution
  let anyDid = false;
  for (const name in Game.creeps) {
    if (creepLogic.run(Game.creeps[name])) anyDid = true;
  }

  // Reward calculation
  let R = -0.1;
  if (A.type === "SPAWN" && (!A.body.includes(MOVE) || !anyDid)) {
    R = -1;
  }
  if (room.controller.level >= 2) R += 20;

  // Learning
  const S2 = state(room);
  brain.learn(S, A, R, S2, ACTIONS);

  // Collect metrics
  if (Memory.epochTick % SAVE_EACH === 0) {
    Memory.evaluation.history.push({
      tick: Game.time,
      controllerLevel: room.controller.level,
      controllerProgress: room.controller.progress,
      harvester: _.countBy(Game.creeps, (c) => c.memory.role).harvester || 0,
      upgrader: _.countBy(Game.creeps, (c) => c.memory.role).upgrader || 0,
    });
  }
  Memory.epochTick++;
};
