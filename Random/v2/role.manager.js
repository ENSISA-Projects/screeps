/******************************************************************************
 *  role.manager.js — colony script
 *  --------------------------------------------------------
 *  On every game tick the script does two things:
 *
 *    1. Spawning
 *       ~33 % chance to spawn a creep with `BASIC_BODY` (cost 200).
 *
 *    2. Creep logic
 *       Each creep cycles **randomly** between two sequential tasks:
 *          • "harvest" – fill its carry with energy
 *          • "upgrade" – spend energy on the room controller
 *
 *       A task is re-drawn as soon as it can no longer progress
 *       (carry full / carry empty).
 ******************************************************************************/

const BASIC_BODY = [WORK, CARRY, MOVE];

const TASKS = ["harvest", "upgrade"];
const randomTask = () => _.sample(TASKS);

// Per-creep behaviour
function runCreep(creep) {
  if (!creep.memory.task) creep.memory.task = randomTask();

  switch (creep.memory.task) {
    case "harvest":
      if (creep.store.getFreeCapacity() === 0) {
        creep.memory.task = randomTask();
        creep.say(`${creep.memory.task}`);
        return;
      }
      const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src) {
        if (creep.harvest(src) === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      }
      break;

    case "upgrade":
      if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.task = randomTask();
        creep.say(`${creep.memory.task}`);
        return;
      }
      const ctrl = creep.room.controller;
      if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          creep.moveTo(ctrl, { visualizePathStyle: { stroke: "#ffffff" } });
        }
      }
      break;
  }
}

// Main game loop — executed every tick
module.exports.loop = function () {
  // SPAWN aléatoire 33 % des ticks
  if (_.random(0, 2) === 0) {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (spawn && spawn.room.energyAvailable >= 200) {
      const name = `Rnd${Game.time}`;
      const ret = spawn.spawnCreep(BASIC_BODY, name);
      if (ret === OK) console.log(`SPAWN ${name}`);
    }
  }

  // Execute / update the task for every existing creep
  for (const name in Game.creeps) {
    runCreep(Game.creeps[name]);
  }
};
