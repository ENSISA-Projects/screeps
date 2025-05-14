/*****************************************************************
 *  main.js – boucle principale avec GA, pause manuelle
 *  • Boot automatique : crée un harvester tant qu’il n’y a aucun creep
 *****************************************************************/
const genetic  = require('genetic');
const roleHarv = require('role.harvester');
const roleUpg  = require('role.upgrader');




function state(room) {
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.some(Game.creeps, c => c.memory.role === 'harvester') ? 1 : 0;
  const u = _.some(Game.creeps, c => c.memory.role === 'upgrader')   ? 1 : 0;
  return `${e}${h}${u}`;
}

module.exports.loop = function () {

  /* ---------- Persistance GA ---------- */
  genetic.load();

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  /* ---------- Init premier tick ---------- */
  if (Memory.evalHistory === undefined) {
    Memory.evalHistory = [];
    Memory.startTick   = Game.time;
  }

  /* ----------- dépausse auto après reset ----------- */
  if (Memory.paused && room.controller.level === 1 && _.isEmpty(Game.creeps)) {
    console.log('[GA] Auto-reprise après resetAllData');
    Memory.paused           = false;
    Memory.waitMsgDisplayed = false;
    Memory.startTick        = Game.time;
  }

  /* ---------- reset monde (RCL2→1) ---------- */
  if (Memory.paused && Memory.prevLevel >= 2 && room.controller.level === 1) {
    Memory.paused      = false;
    Memory.evalHistory = [];
    Memory.startTick   = Game.time;
    console.log(`[GA] Démarrage Gen ${Memory.epochCount}, Ind ${Memory.genIndex}`);
  }

  /* ---------------- état PAUSE ---------------- */
  if (Memory.paused) {
    if (!Memory.waitMsgDisplayed) {
      const attente = Game.time - Memory.startTick;
      console.log(`[GA] En pause depuis ${attente} ticks – prêt pour respawn manuel`);
      Memory.waitMsgDisplayed = true;
    }
    Memory.prevLevel = room.controller.level;
    return;
  }

  /* ---- fin d'individu : passage RCL1→RCL2 ---- */
  if (Memory.prevLevel < 2 && room.controller.level >= 2) {
    console.log(`[GA] RCL2 atteint → fin Ind ${Memory.genIndex}`);
    const evaluated = Memory.genIndex;
    const fit = genetic.finishEvaluation(room);      // met paused=true
    console.log(`[GA] Ind ${evaluated} évalué • fitness=${fit.toFixed(2)}`);
    Memory.prevLevel        = room.controller.level;
    Memory.waitMsgDisplayed = false;
    return;
  }

  /* --------------- Action GA / Boot --------------- */
  const s   = state(room);
  const act = genetic.act(s);
  const sp  = _.find(Game.spawns, sp => !sp.spawning);

  /* Boot : aucun creep → on force un harvester */
  if (_.isEmpty(Game.creeps) && sp) {
    const ret = sp.spawnCreep(
      [WORK, CARRY, MOVE],
      'H' + Game.time,
      { memory: { role: 'harvester' } }
    );
    if (ret !== OK && ret !== ERR_BUSY) {
      console.log(`[BOOT] spawnCreep code=${ret} energy=${room.energyAvailable}`);
    }
  } else if (sp && room.energyAvailable >= 200) {
    if (act === 'SPAWN_HARVESTER') {
      sp.spawnCreep([WORK, CARRY, MOVE], 'H' + Game.time, { memory: { role: 'harvester' } });
    }
    if (act === 'SPAWN_UPGRADER') {
      sp.spawnCreep([WORK, CARRY, MOVE], 'U' + Game.time, { memory: { role: 'upgrader' } });
    }
  }

  /* ------------- Logique creeps ------------- */
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role === 'harvester') roleHarv.run(c);
    if (c.memory.role === 'upgrader')  roleUpg.run(c);
  }

  /* -------------- Collecte métriques -------------- */
  const prevProg = room.controller._prevProg || 0;
  Memory.evalHistory.push({
    controllerProgressDelta: room.controller.progress - prevProg
  });
  room.controller._prevProg = room.controller.progress;

  /* -------------- Timeout sécurité -------------- */
  if (Game.time - Memory.startTick >= genetic.EVAL_TICKS) {
    console.log(`[GA] Timeout atteint → fin Ind ${Memory.genIndex}`);
    const evaluated = Memory.genIndex;
    const fit = genetic.finishEvaluation(room);      // met paused=true
    console.log(`[GA] Ind ${evaluated} évalué • fitness=${fit.toFixed(2)}`);
    Memory.prevLevel        = room.controller.level;
    Memory.waitMsgDisplayed = false;
    return;
  }

  /* --------------- Persistance --------------- */
  genetic.save();
  Memory.prevLevel = room.controller.level;
};
