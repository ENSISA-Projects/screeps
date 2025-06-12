/******************************************************************************
 *  main.js - Advanced Q-learning loop with multi-body spawning and epoch persistence
 *  ----------------------------------------------------------------------
 *  This main-loop script drives a Screeps colony with a tabular Q-learning
 *  brain (`qlearning.js`).  Compared with the simpler examples, it adds:
 *    • **Arbitrary bodies.**  All three-part combinations of {WORK,CARRY,MOVE}
 *      are part of the action space, for both harvesters and upgraders.
 *    • **Evaluation mode.**  Set `Memory.evalMode = true` in console to freeze
 *      the Q-table and run the colony greedily for benchmarking.
 *    • **Epoch control.**  Ends as soon as the room reaches RCL 2, after which the segment is flushed
 *      and a reset is requested.
 *    • **Dual-segment storage.**  Segment 0 stores the Q-table, segment 1
 *      stores detailed metrics for later analysis.
 *    • **Reward shaping & episode learning.**  Negative living cost, positive
 *      rewards for useful spawns and controller progress, strong penalty for
 *      malformed creeps, per-episode learning in the brain helper.
 ******************************************************************************/

const SEG_ID = 0;
const METRICS_SEG = 1;
const SAVE_EACH = 100;

const EVAL = !!Memory.evalMode;

// Generate every combinations of 3-part bodies from {WORK,CARRY,MOVE}
function generateBodyCombos(parts, maxParts) {
  const combos = [];

  function helper(startIdx, depth, buf) {
    if (depth === maxParts) {
      combos.push(buf.slice());
      return;
    }
    for (let i = startIdx; i < parts.length; i++) {
      buf.push(parts[i]);
      helper(i, depth + 1, buf); // repetition authorized
      buf.pop();
    }
  }
  helper(0, 0, []);
  return combos;
}

const ALL_BODIES = generateBodyCombos([WORK, CARRY, MOVE], 3);
const brain = require("qlearning");
const creepLogic = require("creep");

// Signal if learning should be frozen
brain.setFrozen(EVAL);

// Define roles and actions
const ROLES = ["harvester", "upgrader"];
const ACTIONS = [];
for (const body of ALL_BODIES) {
  for (const role of ROLES) {
    ACTIONS.push({ type: "SPAWN", role, body });
  }
}
ACTIONS.push({ type: "WAIT" });

// Utility function
function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(
    (r) => r.controller && r.controller.my
  );
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

// Encode states « energy available | nb harvester | nb upgrader »
function state(room) {
  const energyStatus = room.energyAvailable >= 200 ? 1 : 0;
  const harvesterCount = _.filter(
    Game.creeps,
    (c) => c.memory.role === "harvester"
  ).length;
  const upgraderCount = _.filter(
    Game.creeps,
    (c) => c.memory.role === "upgrader"
  ).length;
  return `${energyStatus}|${harvesterCount}|${upgraderCount}`;
}

// Simple reward function
function calculateReward(room, action) {
  let reward = -1;

  if (action.type === "SPAWN" && room.energyAvailable >= 200) reward += 5;
  if (action.type === "WAIT" && room.energyAvailable >= 200) reward -= 1;

  if (room.controller.progress > (Memory.lastProgress || 0)) {
    reward += room.controller.progress - (Memory.lastProgress || 0);
  }
  Memory.lastProgress = room.controller.progress;

  return reward;
}

// Global memory
if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] Reset complete");
  brain.resetEpisode();
  return;
}

// Stats to follow each epoch
if (!Memory.evaluation) {
  Memory.evaluation = {
    startTick: Game.time,
    actionsTaken: 0,
    episodeStats: [],
    history: [],
  };
}

function ensureEvaluation() {
  if (!Memory.evaluation) {
    Memory.evaluation = {
      startTick: Game.time,
      actionsTaken: 0,
      episodeStats: [],
      history: [],
    };
  }
}

// Main loop
module.exports.loop = function () {
  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  if (Memory.wantReset) {
    for (const name in Game.creeps) {
      Game.creeps[name].suicide();
    }
    if (Game.time % 25 === 0)
      console.log("[EPOCH] wantReset true — waiting reset");

    return;
  }

  ensureEvaluation();
  // Eventual loading of the Q-table from the memory segment
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        Memory.brain = JSON.parse(seg).brain;
        Memory.brainLoaded = true;
        console.log(
          `[PERSIST] Q-table loaded |Q|=${Object.keys(Memory.brain.q).length}`
        );
      } catch (e) {}
    }
    RawMemory.setActiveSegments([]);
  }

  // Reset automatic when reaching RCL 2 (end of epoch)
  if (room.controller.level >= 2 && !Memory.wantReset) {
    // Save brain + metrics
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });

    RawMemory.setActiveSegments([METRICS_SEG]);
    RawMemory.segments[METRICS_SEG] = JSON.stringify(Memory.evaluation);

    const hist = Memory.evaluation.history;
    const summary = {
      startTick: Memory.evaluation.startTick,
      actionsTaken: Memory.evaluation.actionsTaken,
      historyCount: hist.length,
      episodeCount: Memory.brain.stats.episodes,
      avgReward: Memory.brain.stats.avgReward,
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

    // Cleanup then mark wantReset asap
    RawMemory.segments[METRICS_SEG] = "";
    RawMemory.setActiveSegments([]);
    delete Memory.evaluation;
    Memory.wantReset = true;
    console.log("[EPOCH] RCL2 reached, waiting for reset");
    return;
  }

  // Action selection: greedy if EVAL, otherwise ε-greedy
  const currentState = state(room);
  const action = brain.act(currentState, ACTIONS);

  if (!EVAL) Memory.evaluation.actionsTaken++;

  // Execute the chosen action
  if (action.type === "SPAWN") {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawn.spawnCreep(
        action.body,
        `${action.role[0].toUpperCase()}${Game.time}`,
        { memory: { role: action.role } }
      );
    }
  }

  const reward = calculateReward(room, action);

  // Manage creeps + penalty if body is invalid
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

    // Suicide if body is incomplete
    if (
      !creep.getActiveBodyparts(WORK) ||
      !creep.getActiveBodyparts(CARRY) ||
      !creep.getActiveBodyparts(MOVE)
    ) {
      creep.suicide();
      if (!EVAL) brain.learn(currentState, action, -100, state(room), ACTIONS);
      continue;
    }
    creepLogic.run(creep);
  }

  // Record the step + learning per episode
  const episodeComplete = brain.recordStep(currentState, action, reward);

  if (!EVAL && episodeComplete) {
    const stats = brain.learnEpisode(state(room));
    if (stats.episode % 1 === 0) {
      console.log(
        `[QLEARN] Episode ${stats.episode} | AvgR: ${stats.avgReward.toFixed(
          2
        )} | ε: ${stats.epsilon.toFixed(3)}`
      );
    }
  }

  // Log and history in Memory (every SAVE_EACH ticks)
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
