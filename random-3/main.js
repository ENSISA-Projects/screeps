const roleHarvester = require("role.harvester");
const roleBuilder = require("role.builder");
const roleUpgrader = require("role.upgrader");

// Suivi du temps de montée en niveau du contrôleur
if (!Memory.ctrlLevelTimes) {
  Memory.ctrlLevelTimes = {};
}

function logControllerLevelTime(room) {
  const ctrl = room.controller;
  if (!ctrl) return;

  const lvl = ctrl.level;
  const last = Memory.ctrlLevelTimes[room.name] || {
    level: 0,
    time: Game.time,
  };

  if (lvl > last.level) {
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

const BODIES = [
  { cost: 200, body: [WORK, CARRY, MOVE] },
  { cost: 400, body: [WORK, WORK, CARRY, CARRY, MOVE, MOVE] },
  {
    cost: 600,
    body: [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
  },
];

function bestBody(room) {
  const cap = room.energyCapacityAvailable;
  const affordable = _.filter(BODIES, (b) => b.cost <= cap);
  if (!affordable.length) return [WORK, CARRY, MOVE];
  return _.max(affordable, (b) => b.cost).body;
}

function chooseRole() {
  const counts = _.countBy(Game.creeps, (c) => c.memory.role);
  const total = _.size(Game.creeps);

  const harvesters = counts.harvester || 0;
  const upgraders = counts.upgrader || 0;
  const builders = counts.builder || 0;

  // minimum 2 harvesters
  if (harvesters < 2) return "harvester";

  // ratio 60% harvesters ou pas assez?
  if (harvesters / total < 0.6) return "harvester";

  // pas plus d'1 builder si on a moins de 5 creeps
  const hasLevel2Room = _.some(
    Game.rooms,
    (room) => room.controller && room.controller.level >= 2
  );

  if (hasLevel2Room && builders < 2 && total >= 4) return "builder";

  // limite upgraders
  if (upgraders < harvesters && upgraders < 3) return "upgrader";

  // sinon random entre harvester/upgrader
  return _.sample(["harvester", "upgrader"]);
}

module.exports.loop = function () {
  try {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    const room = spawn.room;

    // Cas spécial (suicide de la colonie) => on doit relancer
    if (spawn && _.isEmpty(Game.creeps)) {
      const body = [WORK, CARRY, MOVE]; // 200 énergie
      if (room.energyAvailable >= 200) {
        spawn.spawnCreep(body, "Boot" + Game.time, {
          memory: { role: "harvester" },
        });
      }
      return;
    }

    // Spawn ~33% des ticks (si creeps vivants)
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

    // Log du contrôleur
    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller && room.controller.my) {
        logControllerLevelTime(room);
      }
    }

    // Exécution des rôles
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
          creep.say("❓");
      }
    }
  } catch (err) {
    console.log("💥 Error in main loop:", err.stack || err.message);
  }
};
