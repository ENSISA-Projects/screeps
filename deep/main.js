// main.js
const creepAI = require("creep");
module.exports.loop = function () {
  // Suicide si corps incomplet (WORK/CARRY/MOVE manquant)
  const room = Object.values(Game.rooms).find(
    (r) => r.controller && r.controller.my
  );
  if (room) {
    Memory.dqn_ctrl_level = room.controller.level; // ← optionnel
  }

  const alive = _.filter(Game.creeps, (c) => !c.spawning);
  Memory.dqn_creep_count = alive.length;
  console.log(Memory.dqn_creep_count);
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    const room = Object.values(Game.rooms).find(
      (r) => r.controller && r.controller.my
    );

    if (
      !creep.getActiveBodyparts(WORK) ||
      !creep.getActiveBodyparts(CARRY) ||
      !creep.getActiveBodyparts(MOVE)
    ) {
      creep.suicide();
      continue;
    }

    creepAI.run(creep);
  }
};
