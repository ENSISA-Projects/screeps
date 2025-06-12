/******************************************************************************
 *  Screeps main loop with Genetic-Algorithm-driven spawning
 *  --------------------------------------------------------
 *  This script connects the “genetic” module (an in-memory genetic algorithm)
 *  to the room’s decision cycle.  Each game tick it
 *
 *    1. Restores GA state from RawMemory (genetic.load()).
 *    2. Computes a 3-bit world-state:      e h u
 *         • e = 1 if room.energyAvailable ≥ 200
 *         • h = 1 if ≥ 1 harvester exists
 *         • u = 1 if ≥ 1 upgrader  exists
 *    3. Asks the GA which action to execute in that state
 *         → “SPAWN_HARVESTER”, “SPAWN_UPGRADER”, or “WAIT”.
 *    4. Spawns creeps accordingly and runs their role logic.
 *    5. Records controller-progress deltas for fitness evaluation.
 *    6. Ends an individual either:
 *         • on RCL 1 → 2 transition, or
 *         • after genetic.EVAL_TICKS timeout.
 *       The GA then scores the individual, breeds if necessary,
 *       persists its new population, and may pause while the colony resets.
 *
 *  This in-file documentation only adds comments; the executable logic
 *  remains unchanged.
 ******************************************************************************/

const genetic = require("genetic");
const roleHarv = require("role.harvester");
const roleUpg = require("role.upgrader");

function state(room) {
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.some(Game.creeps, (c) => c.memory.role === "harvester") ? 1 : 0;
  const u = _.some(Game.creeps, (c) => c.memory.role === "upgrader") ? 1 : 0;
  return `${e}${h}${u}`;
}

module.exports.loop = function () {
  // GA Persistence
  genetic.load();

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  // Init premier tick
  if (Memory.evalHistory === undefined) {
    Memory.evalHistory = [];
    Memory.startTick = Game.time;
  }

  // Unpause auto
  if (Memory.paused && room.controller.level === 1 && _.isEmpty(Game.creeps)) {
    console.log("[GA] Auto-unpause after resetAllData");
    Memory.paused = false;
    Memory.waitMsgDisplayed = false;
    Memory.startTick = Game.time;
  }

  // Reset world (RCL2→1)
  if (Memory.paused && Memory.prevLevel >= 2 && room.controller.level === 1) {
    Memory.paused = false;
    Memory.evalHistory = [];
    Memory.startTick = Game.time;
    console.log(`[GA] Start Gen ${Memory.epochCount}, Ind ${Memory.genIndex}`);
  }

  // Pause = wait for respawn
  if (Memory.paused) {
    if (!Memory.waitMsgDisplayed) {
      const waiting = Game.time - Memory.startTick;
      console.log(
        `[GA] On pause from ${waiting} ticks – ready for manual respawn`
      );
      Memory.waitMsgDisplayed = true;
    }
    Memory.prevLevel = room.controller.level;
    return;
  }

  // End of individual: transition RCL1→RCL2
  if (Memory.prevLevel < 2 && room.controller.level >= 2) {
    console.log(`[GA] RCL2 reached → end Ind ${Memory.genIndex}`);
    const evaluated = Memory.genIndex;
    const fit = genetic.finishEvaluation(room); // met paused=true
    console.log(`[GA] Ind ${evaluated} evaluated, fitness=${fit.toFixed(2)}`);
    Memory.prevLevel = room.controller.level;
    Memory.waitMsgDisplayed = false;
    return;
  }

  // GA Actions / Boot
  const s = state(room);
  const act = genetic.act(s);
  const sp = _.find(Game.spawns, (sp) => !sp.spawning);

  // Boot : no creep, force a harvester
  if (_.isEmpty(Game.creeps) && sp) {
    const ret = sp.spawnCreep([WORK, CARRY, MOVE], "H" + Game.time, {
      memory: { role: "harvester" },
    });
    if (ret !== OK && ret !== ERR_BUSY) {
      console.log(
        `[BOOT] spawnCreep code=${ret} energy=${room.energyAvailable}`
      );
    }
  } else if (sp && room.energyAvailable >= 200) {
    if (act === "SPAWN_HARVESTER") {
      sp.spawnCreep([WORK, CARRY, MOVE], "H" + Game.time, {
        memory: { role: "harvester" },
      });
    }
    if (act === "SPAWN_UPGRADER") {
      sp.spawnCreep([WORK, CARRY, MOVE], "U" + Game.time, {
        memory: { role: "upgrader" },
      });
    }
  }

  // Creeps logic
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === "harvester") roleHarv.run(c);
    if (c.memory.role === "upgrader") roleUpg.run(c);
  }

  // Metrics collection
  const prevProg = room.controller._prevProg || 0;
  Memory.evalHistory.push({
    controllerProgressDelta: room.controller.progress - prevProg,
  });
  room.controller._prevProg = room.controller.progress;

  // Timeout
  if (Game.time - Memory.startTick >= genetic.EVAL_TICKS) {
    console.log(`[GA] Timeout reached → end Ind ${Memory.genIndex}`);
    const evaluated = Memory.genIndex;
    const fit = genetic.finishEvaluation(room); // paused=true
    console.log(`[GA] Ind ${evaluated} evaluated, fitness=${fit.toFixed(2)}`);
    Memory.prevLevel = room.controller.level;
    Memory.waitMsgDisplayed = false;
    return;
  }

  // GA Persistence
  genetic.save();
  Memory.prevLevel = room.controller.level;
};
