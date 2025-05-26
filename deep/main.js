// main.js
const creepAI = require("creep");
module.exports.loop = function () {
  // Suicide si corps incomplet (WORK/CARRY/MOVE manquant)
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

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
