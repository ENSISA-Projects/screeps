/* Corps minimal : 200 énergie */
const BASIC_BODY = [WORK, CARRY, MOVE];

/* TÂCHES qu’un creep peut enchaîner séquentiellement niveau 1 -> 2 */
const TASKS = ['harvest', 'upgrade'];
const randomTask = () => _.sample(TASKS);

function runCreep(creep) {

  /* Attribution initiale aléatoire */
  if (!creep.memory.task) creep.memory.task = randomTask();

  switch (creep.memory.task) {

    /* =============== HARVEST =============== */
    case 'harvest':
      /* S’il est plein → nouvelle tâche aléatoire au tick suivant */
      if (creep.store.getFreeCapacity() === 0) {
        creep.memory.task = randomTask();
        creep.say(`➡️ ${creep.memory.task}`);
        return;
      }
      const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src) {
        if (creep.harvest(src) === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
      }
      break;

    /* =============== UPGRADE =============== */
    case 'upgrade':
      /* S’il est vide → nouvelle tâche aléatoire au tick suivant */
      if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.task = randomTask();
        creep.say(`➡️ ${creep.memory.task}`);
        return;
      }
      const ctrl = creep.room.controller;
      if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          creep.moveTo(ctrl, { visualizePathStyle: { stroke: '#ffffff' } });
        }
      }
      break;
  }
}
//TODO mettre dans le main
module.exports.loop = function () {

  /* 1 : SPAWN aléatoire 33 % des ticks */
  if (_.random(0, 2) === 0) {                   // 0,1,2 → ~1 / 3 chance
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (spawn && spawn.room.energyAvailable >= 200) {
      const name = `Rnd${Game.time}`;
      const ret  = spawn.spawnCreep(BASIC_BODY, name);
      if (ret === OK) console.log(`🔀 SPAWN ${name}`);
    }
  }

  /* 2 : Creeps → séquentiel + choix aléatoire aux transitions */
  for (const name in Game.creeps) {
    runCreep(Game.creeps[name]);
  }
};
