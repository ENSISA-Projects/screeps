/******************************************************************************
 *  role.manager.js — minimal “coin-flip” colony driver
 *  ---------------------------------------------------
 *  This script is *not* an intelligent AI: each tick it simply chooses one
 *  action at random among:
 *
 *      • "SPAWN"   – create a creep with the BASIC_BODY
 *      • "HARVEST" – order every creep to harvest the nearest source
 *      • "UPGRADE" – order every creep to upgrade the room controller
 ******************************************************************************/

const ACTIONS = ["SPAWN", "HARVEST", "UPGRADE"];

// Minimal body costs 200 energy
const BASIC_BODY = [WORK, CARRY, MOVE];

const handlers = {
  /* ***********************************************************************
   *  SPAWN
   *  -----
   *  • Finds the first idle spawn in the room.
   *  • If at least 200 energy is available, spawns a creep with BASIC_BODY.
   ********************************************************************** */
  SPAWN() {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (!spawn) return;

    if (spawn.room.energyAvailable >= 200) {
      const name = `rndCreep${Game.time}`;
      const ret = spawn.spawnCreep(BASIC_BODY, name);
      if (ret === OK) {
        console.log(`[RANDOM] SPAWN → ${name}`);
      }
    }
  },

  /* ***********************************************************************
   *  HARVEST
   *  -------
   *  • For every creep, move/harvest the closest active source.
   ********************************************************************** */
  HARVEST() {
    console.log("[RANDOM] HARVEST");
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src) {
        if (creep.harvest(src) === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      }
    }
  },

  /* ***********************************************************************
   *  UPGRADE
   *  -------
   *  • For every creep, move/upgrade the room controller.
   ********************************************************************** */
  UPGRADE() {
    console.log("[RANDOM] UPGRADE");
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const ctrl = creep.room.controller;
      if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          creep.moveTo(ctrl, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
    }
  },
};

// Main loop — executed once per tick
module.exports.loop = function () {
  // Pick a random action and execute its handler
  const action = _.sample(ACTIONS);
  handlers[action]();
};
