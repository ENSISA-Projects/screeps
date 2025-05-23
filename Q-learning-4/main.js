// main-improved.js
const SEG_ID = 0;
const EPOCH_TICKS = 6000;
const METRICS_SEG = 1;
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

  const myRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] Reset complete");
  brain.resetEpisode();
}

if (!Memory.evaluation) {
  Memory.evaluation = {
    startTick: Game.time,
    actionsTaken: 0,
    episodeStats: [],
    history: []
  };
}

function state(room) {
  const energyStatus = room.energyAvailable >= 200 ? 1 : 0;
  const harvesterCount = _.filter(Game.creeps, c => c.memory.role === "harvester").length;
  const upgraderCount = _.filter(Game.creeps, c => c.memory.role === "upgrader").length;
  return `${energyStatus}|${harvesterCount}|${upgraderCount}`;
}

function calculateReward(room, action) {
  let reward = -10;
  
  if (action.type === "SPAWN" && room.energyAvailable >= 200) {
    reward += 0.5;
  }
  
  if (action.type === "WAIT" && room.energyAvailable >= 200) {
    reward -= 0.2;
  }
  
  if (room.controller.progress > (Memory.lastProgress || 0)) {
    reward += (room.controller.progress - (Memory.lastProgress || 0)) / 100;
  }
  Memory.lastProgress = room.controller.progress;
  
  return reward;
}

module.exports.loop = function() {
  const room = Game.rooms[Object.keys(Game.rooms)[0]];

  const S = state(room)

  if (Memory.wantReset) return;

  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        Memory.brain = JSON.parse(seg).brain;
        Memory.brainLoaded = true;
        console.log(`[PERSIST] Q-table loaded |Q|=${Object.keys(Memory.brain.q).length}`);
      } catch (e) {
      }
    }
    RawMemory.setActiveSegments([]);
  }

  if (!room) return;

  if (room.controller.level >= 2 && !Memory.wantReset) {
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
        harvester: _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
        upgrader: _.countBy(Game.creeps, c => c.memory.role).upgrader || 0,
      },
    };
    console.log("[METRICS]", JSON.stringify(summary));

    RawMemory.segments[METRICS_SEG] = "";
    RawMemory.setActiveSegments([]);
    delete Memory.evaluation;
    Memory.wantReset = true;
    console.log("[EPOCH] RCL2 reached, waiting for reset");
    return;
  }

  const currentState = state(room);
  const action = brain.act(currentState, ACTIONS);
  Memory.evaluation.actionsTaken++;

  if (action.type === "SPAWN") {
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawn.spawnCreep(action.body, `${action.role[0].toUpperCase()}${Game.time}`, {
        memory: { role: action.role }
      });
    }
  }
reward = calculateReward(room, action);
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep.getActiveBodyparts(WORK) || !creep.getActiveBodyparts(CARRY) || !creep.getActiveBodyparts(MOVE)) {
      creep.suicide();
      brain.learn(S, action, -50, state(room), ACTIONS); // Penalize the action that spawned the invalid creep
      continue;
    }
    creepLogic.run(creep);
  }

  const episodeComplete = brain.recordStep(currentState, action, reward);

  if (episodeComplete) {
    const stats = brain.learnEpisode(state(room));
    
    Memory.evaluation.episodeStats.push({
      tick: Game.time,
      epNum: stats.episode,
      avgReward: stats.avgReward,
      qSize: stats.qSize,
      epsilon: stats.epsilon
    });
    
    if (stats.episode % 1=== 0) {
      console.log(`[QLEARN] Episode ${stats.episode} | Avg Reward: ${stats.avgReward.toFixed(2)} | ε: ${stats.epsilon.toFixed(3)}`);
    }
  }

  if (Memory.epochTick % SAVE_EACH === 0) {
    Memory.evaluation.history.push({
      tick: Game.time,
      controllerLevel: room.controller.level,
      controllerProgress: room.controller.progress,
      harvester: _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
      upgrader: _.countBy(Game.creeps, c => c.memory.role).upgrader || 0,
    });
  }
  Memory.epochTick++;
};