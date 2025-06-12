module.exports = {
  run(creep) {
    const room = creep.room;

    if (creep.store[RESOURCE_ENERGY] === 0) {
      const source =
        room.storage && room.storage.store[RESOURCE_ENERGY] > 0
          ? room.storage
          : creep.pos.findClosestByPath(FIND_STRUCTURES, {
              filter: (s) =>
                (s.structureType === STRUCTURE_CONTAINER ||
                  s.structureType === STRUCTURE_STORAGE ||
                  ((s.structureType === STRUCTURE_SPAWN ||
                    s.structureType === STRUCTURE_EXTENSION) &&
                    s.my)) &&
                s.store[RESOURCE_ENERGY] > 0,
            });

      if (source) {
        if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source);
        }
      }
      return;
    }

    const sites = room.find(FIND_CONSTRUCTION_SITES);
    const extensions = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_EXTENSION,
    });

    // Create up to 2 extensions if controller is level 2
    if (room.controller.level >= 2) {
      const extSites = sites.filter(
        (s) => s.structureType === STRUCTURE_EXTENSION
      );
      if (extensions.length + extSites.length < 2) {
        const terrain = room.getTerrain();
        const targetPos = room.controller.pos;

        for (let dx = -3; dx <= 3; dx++) {
          for (let dy = -3; dy <= 3; dy++) {
            const x = targetPos.x + dx;
            const y = targetPos.y + dy;

            if (
              terrain.get(x, y) === 0 &&
              room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length === 0 &&
              room.lookForAt(LOOK_STRUCTURES, x, y).length === 0
            ) {
              if (creep.pos.isNearTo(x, y)) {
                room.createConstructionSite(x, y, STRUCTURE_EXTENSION);
              } else {
                creep.moveTo(x, y);
              }
              return;
            }
          }
        }
      }
    }

    // Build the closest construction site
    if (sites.length > 0) {
      const site = creep.pos.findClosestByPath(sites);
      if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
          creep.moveTo(site);
        }
        return;
      }
    }

    // Set roads if no construction sites exist
    const sources = room.find(FIND_SOURCES);
    const storageTargets = room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_CONTAINER,
    });

    // Utility: place a road only if the tile is clear *and* not the controller / a spawn
    function tryBuildRoad(room, x, y) {
      // Never on the room controller
      if (
        room.controller &&
        room.controller.pos.x === x &&
        room.controller.pos.y === y
      )
        return;

      // Never on an owned spawn
      if (
        room
          .lookForAt(LOOK_STRUCTURES, x, y)
          .some((s) => s.structureType === STRUCTURE_SPAWN)
      )
        return;

      // Skip if a road already exists or is queued
      if (
        room
          .lookForAt(LOOK_STRUCTURES, x, y)
          .some((s) => s.structureType === STRUCTURE_ROAD) ||
        room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0
      )
        return;

      room.createConstructionSite(x, y, STRUCTURE_ROAD);
    }

    // Roads from each source to every storage/extension/… target
    for (const src of sources) {
      for (const target of storageTargets) {
        const path = room.findPath(src.pos, target.pos, { ignoreCreeps: true });
        for (const pos of path) {
          tryBuildRoad(room, pos.x, pos.y);
        }
      }
    }

    // Roads from every storage target to the room controller
    for (const target of storageTargets) {
      const path = room.findPath(target.pos, room.controller.pos, {
        ignoreCreeps: true,
      });
      for (const pos of path) {
        tryBuildRoad(room, pos.x, pos.y);
      }
    }

    // Wait at the controller (maybe we could suicide)
    creep.moveTo(room.controller);
  },
};
