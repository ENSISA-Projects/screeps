const ACTIONS = ['SPAWN', 'HARVEST', 'UPGRADE'];

/** Corps minimal — 200 énergie */
const BASIC_BODY = [WORK, CARRY, MOVE];

/** Dictionnaire des fonctions à exécuter */
const handlers = {

  SPAWN() {
    // prend le premier spawn libre
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (!spawn) return;

    if (spawn.room.energyAvailable >= 200) {
      const name = `rndCreep${Game.time}`;
      const ret  = spawn.spawnCreep(BASIC_BODY, name);
      if (ret === OK) {
        console.log(`[RANDOM] SPAWN → ${name}`);
      }
    }
  },

  HARVEST() {
    console.log('[RANDOM] HARVEST');
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const src   = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src) {
        if (creep.harvest(src) === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { visualizePathStyle: { stroke: '#ffaa00' } });
        }
      }
    }
  },

  UPGRADE() {
    console.log('[RANDOM] UPGRADE');
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      const ctrl  = creep.room.controller;
      if (ctrl) {
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
          creep.moveTo(ctrl, { visualizePathStyle: { stroke: '#ffffff' } });
        }
      }
    }
  }
};

module.exports.loop = function () {

  /* --- Sélection aléatoire de l’action --- */
  const action = _.sample(ACTIONS);   // _.sample fait partie de lodash, dispo nativement
  handlers[action]();

  /* --- Log facultatif des ressources de la room principale --- */
  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (room) {
    console.log(`Room ${room.name}: ${room.energyAvailable}/${room.energyCapacityAvailable} energy`);
  }
};
