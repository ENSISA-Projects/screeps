module.exports = {
  run(creep) {
    /* 1. Si vide → prendre énergie dans un stockage proche */
    if (creep.store[RESOURCE_ENERGY] === 0) {
      const source = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        filter: (s) =>
          (((s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION) &&
            s.my) ||
            s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
          s.store[RESOURCE_ENERGY] > 0,
      });

      if (source) {
        if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
        }
      }
      return;
    }

    /* 2. Sinon → upgrade le contrôleur */
    const ctrl = creep.room.controller;
    if (ctrl && creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
      creep.moveTo(ctrl, { visualizePathStyle: { stroke: "#ffffff" } });
    }
  },
};
