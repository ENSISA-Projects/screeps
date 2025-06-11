module.exports = {
  run(creep) {
    const room = creep.room;

    // 0) Récupérer de l'énergie si vide
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

    // 1) Créer jusqu’à 2 extensions si le contrôleur est niveau 2
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

    // 2) Construire le chantier le plus proche
    if (sites.length > 0) {
      const site = creep.pos.findClosestByPath(sites);
      if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
          creep.moveTo(site);
        }
        return;
      }
    }

    // 3) Poser des routes si aucun chantier n'existe
    const sources = room.find(FIND_SOURCES);
    const storageTargets = room.find(FIND_MY_STRUCTURES, {
      filter: (s) =>
        s.structureType === STRUCTURE_STORAGE ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_CONTAINER,
    });

    // Routes entre sources et stockages
    for (const src of sources) {
      for (const target of storageTargets) {
        const path = room.findPath(src.pos, target.pos, { ignoreCreeps: true });
        for (const pos of path) {
          if (
            room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y).length ===
              0 &&
            room
              .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
              .every((s) => s.structureType !== STRUCTURE_ROAD)
          ) {
            room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
          }
        }
      }
    }

    // Routes entre stockage et contrôleur
    for (const target of storageTargets) {
      const path = room.findPath(target.pos, room.controller.pos, {
        ignoreCreeps: true,
      });
      for (const pos of path) {
        if (
          room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y).length === 0 &&
          room
            .lookForAt(LOOK_STRUCTURES, pos.x, pos.y)
            .every((s) => s.structureType !== STRUCTURE_ROAD)
        ) {
          room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
        }
      }
    }
    //TODO interdire route sur le controlleur / spawner
    // 4) Attente active : se déplacer vers le contrôleur
    creep.moveTo(room.controller);
  },
};
