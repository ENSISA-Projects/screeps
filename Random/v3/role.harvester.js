module.exports = {
  run(creep) {
    if (creep.store.getFreeCapacity() > 0) {
      const src = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
      if (src && creep.harvest(src) === ERR_NOT_IN_RANGE) {
        creep.moveTo(src);
      }
      return;
    }

    const target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
      filter: (s) =>
        (((s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) &&
          s.my) ||
          s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    if (target) {
      if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    }
  },
};
