/* ---------- constantes de persistance ---------- */
const SEG_ID    = 0;     // numéro du segment (0‑99)
const SAVE_EACH = 100;
const EPOCH = 5;
/* ----------------------------------------------- */

const brain        = require('qlearning');
const roleHarv     = require('role.harvester');
const roleUpg      = require('role.upgrader');

const ACTIONS      = ['SPAWN_HARVESTER', 'SPAWN_UPGRADER', 'WAIT'];
const BODY_HARV    = [WORK, CARRY, MOVE];
const BODY_UPG     = [WORK, CARRY, MOVE];

function state(room) {
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.some(Game.creeps, c => c.memory.role === 'harvester') ? 1 : 0;
  const u = _.some(Game.creeps, c => c.memory.role === 'upgrader')  ? 1 : 0;
  return `${e}${h}${u}`;
}

module.exports.loop = function () {

  // (dé)‑sérialisation de la Q‑table 
  RawMemory.setActiveSegments([SEG_ID]);

  // chargement unique après un reset
  if (!Memory.brainLoaded && RawMemory.segments[SEG_ID]) {
    try {
      const data = JSON.parse(RawMemory.segments[SEG_ID]);
      Memory.brain       = data.brain;
      Memory.brainLoaded = true;
      console.log(`[PERSIST] Q‑table restaurée, |Q|=${Object.keys(data.brain.q).length}`);
    } catch (e) {
      console.log('[PERSIST] erreur JSON', e);
    }
  }

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  const S = state(room);
  const A = brain.act(S, ACTIONS);
  let   R = -0.1;

  switch (A) {
    case 'SPAWN_HARVESTER': {
      const spawn = _.find(Game.spawns, s => !s.spawning);
      if (spawn && room.energyAvailable >= 200) {
        if (spawn.spawnCreep(BODY_HARV, 'H' + Game.time, { memory: { role: 'harvester' } }) === OK)
          console.log('[Q] spawn harvester');
      }
      break;
    }
    case 'SPAWN_UPGRADER': {
      const spawn = _.find(Game.spawns, s => !s.spawning);
      if (spawn && room.energyAvailable >= 200) {
        if (spawn.spawnCreep(BODY_UPG, 'U' + Game.time, { memory: { role: 'upgrader' } }) === OK)
          console.log('[Q] spawn upgrader');
      }
      break;
    }
    case 'WAIT': break;
  }

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role === 'harvester') roleHarv.run(creep);
    if (creep.memory.role === 'upgrader')  roleUpg.run(creep);
  }

  if (room.controller.level === 2) R += 20;
  else {
    const delta = room.controller.progress - (room.controller._prevProg || 0);
    if (delta > 0) R += 1;
    room.controller._prevProg = room.controller.progress;
  }

  const sp = room.find(FIND_MY_SPAWNS)[0];
  if (sp && room.energyAvailable === room.energyCapacityAvailable && !sp.spawning) R -= 0.5;

  const S2 = state(room);
  brain.learn(S, A, R, S2, ACTIONS);

  if (Game.time % SAVE_EACH === 0 && Memory.brain) {
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });
    console.log('[PERSIST] Q‑table sauvegardée (' + Game.time + ')');
  }
  
  if (room.controller.level === 2||Game.time % EPOCH === 0) {
  // 1) sauvegarde forcée du segment
  RawMemory.segments[0] = JSON.stringify({ brain: Memory.brain });
  RawMemory.setActiveSegments([0]);      // écrit au tick courant

  // 2) demande un reset externe
  Memory.wantReset = true;
  Game.notify('Époque terminée, resetUser à lancer', 60);
}
};
