/******************************************************************************
 *  main.js — guided random role-based colony manager with spawn heuristics
 *  ---------------------------------------------------------
 *  Features
 *  --------
 *  • **Three creep roles** handled by separate modules:
 *        – role.harvester
 *        – role.builder
 *        – role.upgrader
 *  • **Adaptive spawning**
 *        – Chooses the largest affordable body from BODIES.
 *        – Simple heuristic to keep the economy balanced:
 *            ▸ ≥ 2 harvesters at all times
 *            ▸ harvesters ≈ 60 % of total creeps
 *            ▸ up to 2 builders once a room reaches RCL ≥ 2
 *            ▸ ≤ 3 upgraders, never more than harvesters
 *  • **Controller-level timing**
 *        – Logs how many ticks each room takes to advance controller levels
 *          (1→2, 2→3, …).
 *  • **Failsafe bootstrap**
 *        – If the colony wipes, the script force-spawns a lone harvester.
 ******************************************************************************/

const roleHarvester = require("role.harvester");
const roleBuilder = require("role.builder");
const roleUpgrader = require("role.upgrader");

// how long each room spends at a given controller level
if (!Memory.ctrlLevelTimes) {
  Memory.ctrlLevelTimes = {};
}
// Record time spent at each controller level and log milestones
function logControllerLevelTime(room) {
  const ctrl = room.controller;
  if (!ctrl) return;

  const lvl = ctrl.level;
  const last = Memory.ctrlLevelTimes[room.name] || {
    level: 0,
    time: Game.time,
  };

  if (lvl > last.level && lvl > 1) {
    const delta = Game.time - last.time;
    console.log(
      `Room ${room.name} controller leveled up: ${last.level} -> ${lvl} in ${delta} ticks.`
    );

    if (last.level === 1) {
      console.log(`Level 1→2 in ${delta} ticks`);
    } else if (last.level === 2) {
      console.log(`Level 2→3 in ${delta} ticks`);
    }

    Memory.ctrlLevelTimes[room.name] = { level: lvl, time: Game.time };
  }
}

// Pre-defined body tiers (indexed by energy cost)
const BODIES = [
  { cost: 200, body: [WORK, CARRY, MOVE] },
  { cost: 400, body: [WORK, WORK, CARRY, CARRY, MOVE, MOVE] },
  {
    cost: 600,
    body: [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
  },
];

// Return the most expensive body we can afford right now (storages energy cap).
function bestBody(room) {
  const cap = room.energyCapacityAvailable;
  const affordable = _.filter(BODIES, (b) => b.cost <= cap);
  if (!affordable.length) return [WORK, CARRY, MOVE];
  return _.max(affordable, (b) => b.cost).body;
}

// Heuristic role selector for the next creep
function chooseRole() {
  const counts = _.countBy(Game.creeps, (c) => c.memory.role);
  const total = _.size(Game.creeps);

  const harvesters = counts.harvester || 0;
  const upgraders = counts.upgrader || 0;
  const builders = counts.builder || 0;

  // minimum 2 harvesters
  if (harvesters < 2) return "harvester";

  // ratio 60% harvesters (maybe not even enough ...)
  if (harvesters / total < 0.6) return "harvester";

  // allow 2 builders if RCL >= 2
  const hasLevel2Room = _.some(
    Game.rooms,
    (room) => room.controller && room.controller.level >= 2
  );

  if (hasLevel2Room && builders < 2 && total >= 4) return "builder";

  // limit upgraders
  if (upgraders < harvesters && upgraders < 3) return "upgrader";

  // otherwise random between harvester/upgrader
  return _.sample(["harvester", "upgrader"]);
}

// Main loop - runs every tick
module.exports.loop = function () {
  try {
    // Spawn selection
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (!spawn) return;
    const room = spawn.room;

    // Colony wiped? Bootstrap with a single harvester
    if (spawn && _.isEmpty(Game.creeps)) {
      const body = [WORK, CARRY, MOVE]; // 200 énergie
      if (room.energyAvailable >= 200) {
        spawn.spawnCreep(body, "Boot" + Game.time, {
          memory: { role: "harvester" },
        });
      }
      return;
    }

    // Attempt to spawn ≈ 33 % of the ticks
    if (_.random(0, 2) === 0 && spawn) {
      const body = bestBody(room);
      const cost = _.sum(body, (p) => BODYPART_COST[p]);

      if (room.energyAvailable >= cost) {
        const role = chooseRole();
        spawn.spawnCreep(body, `${role[0].toUpperCase()}${Game.time}`, {
          memory: { role },
        });
      }
    }

    // Log controller level times
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller && room.controller.my) {
        logControllerLevelTime(room);
      }
    }

    // Execute creep roles
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      switch (creep.memory.role) {
        case "harvester":
          roleHarvester.run(creep);
          break;
        case "builder":
          roleBuilder.run(creep);
          break;
        case "upgrader":
          roleUpgrader.run(creep);
          break;
        default:
          creep.say("error");
      }
    }
  } catch (err) {
    console.log("Error in main loop:", err.stack || err.message);
  }
};
