


const SEG_ID      = 0;
const METRICS_SEG = 1;
const EPOCH_TICKS = 6000;
const SAVE_EACH   = 100;

/**
 * Activez/désactivez le mode d’évaluation depuis la console :
 *   Memory.evalMode = true;   // fige la Q-table, aucune mise à jour
 *   Memory.evalMode = false;  // réactive l’apprentissage
 */
const EVAL = !!Memory.evalMode;          // ← flag runtime (true = évaluation)

// -----------------------------------------------------------------------------
// Génération de toutes les combinaisons exactes de 3 parties de corps
// -----------------------------------------------------------------------------
function generateBodyCombos(parts, maxParts) {
  const combos = [];

  function helper(startIdx, depth, buf) {
    if (depth === maxParts) { combos.push(buf.slice()); return; }
    for (let i = startIdx; i < parts.length; i++) {
      buf.push(parts[i]);
      helper(i, depth + 1, buf);   // i (pas i+1) ⇒ répétition autorisée
      buf.pop();
    }
  }
  helper(0, 0, []);
  return combos;
}

const ALL_BODIES = generateBodyCombos([WORK, CARRY, MOVE], 3);
const brain      = require("qlearning");
const creepLogic = require("creep");

// Signale au cerveau si l’apprentissage doit être gelé
brain.setFrozen(EVAL);

// -----------------------------------------------------------------------------
// Actions possibles (SPAWN + WAIT)
// -----------------------------------------------------------------------------
const ROLES   = ["harvester", "upgrader"];
const ACTIONS = [];
for (const body of ALL_BODIES) {
  for (const role of ROLES) {
    ACTIONS.push({ type: "SPAWN", role, body });
  }
}
ACTIONS.push({ type: "WAIT" });

// -----------------------------------------------------------------------------
// Fonctions utilitaires diverses
// -----------------------------------------------------------------------------
function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}


// Encodage d’état « énergie disponible | nb harvester | nb upgrader »
function state(room) {
  const energyStatus   = room.energyAvailable >= 200 ? 1 : 0;
  const harvesterCount = _.filter(Game.creeps, c => c.memory.role === "harvester").length;
  const upgraderCount  = _.filter(Game.creeps, c => c.memory.role === "upgrader").length;
  return `${energyStatus}|${harvesterCount}|${upgraderCount}`;
}

// Fonction de récompense simple (à adapter librement)
function calculateReward(room, action) {
  let reward = -1;

  if (action.type === "SPAWN" && room.energyAvailable >= 200) reward += 5;
  if (action.type === "WAIT"  && room.energyAvailable >= 200) reward -= 1;

  if (room.controller.progress > (Memory.lastProgress || 0)) {
    reward += (room.controller.progress - (Memory.lastProgress || 0));
  }
  Memory.lastProgress = room.controller.progress;

  return reward;
}

  // Mémoire globale
if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] Reset complete");
  brain.resetEpisode();
  return;
}

// Stats pour le suivi de chaque « époque »
if (!Memory.evaluation) {
  Memory.evaluation = {
    startTick: Game.time,
    actionsTaken: 0,
    episodeStats: [],
    history: []
  };
}

function ensureEvaluation() {
  if (!Memory.evaluation) {
    Memory.evaluation = {
      startTick:    Game.time,
      actionsTaken: 0,
      episodeStats: [],
      history:      []
    };
  }
}

// -----------------------------------------------------------------------------
// Boucle principale Screeps
// -----------------------------------------------------------------------------
module.exports.loop = function () {
  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;
  
  if (Memory.wantReset) {
    // Optionnel : hâter le wipe en supprimant tous les creeps vivants.
    for (const name in Game.creeps) {
      Game.creeps[name].suicide();
    }
    if (Game.time % 25 === 0)
      console.log("[EPOCH] wantReset actif — en attente du wipe");

    return;                       // ← on saute toute la suite du tick
  }

  ensureEvaluation();
  // ---------------------------------------------------------------------------
  // Chargement éventuel de la Q-table depuis le segment mémoire
  // ---------------------------------------------------------------------------
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        Memory.brain = JSON.parse(seg).brain;
        Memory.brainLoaded = true;
        console.log(`[PERSIST] Q-table loaded |Q|=${Object.keys(Memory.brain.q).length}`);
      } catch (e) {}
    }
    RawMemory.setActiveSegments([]);
  }

  // ---------------------------------------------------------------------------
  // Reset automatique lorsqu’on atteint RCL 2 (fin d’époque)
  // ---------------------------------------------------------------------------
  if (room.controller.level >= 2 && !Memory.wantReset) {
    // Sauvegarde cerveau + métriques
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });

    RawMemory.setActiveSegments([METRICS_SEG]);
    RawMemory.segments[METRICS_SEG] = JSON.stringify(Memory.evaluation);

    const hist    = Memory.evaluation.history;
    const summary = {
      startTick:        Memory.evaluation.startTick,
      actionsTaken:     Memory.evaluation.actionsTaken,
      historyCount:     hist.length,
      episodeCount:     Memory.brain.stats.episodes,
      avgReward:        Memory.brain.stats.avgReward,
      controllerLevel:  room.controller.level,
      firstEntry:       hist[0],
      lastEntry: {
        tick:            Game.time,
        controllerLevel: room.controller.level,
        controllerProgress: room.controller.progress,
        harvester:         _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
        upgrader:          _.countBy(Game.creeps, c => c.memory.role).upgrader  || 0
      }
    };
    console.log("[METRICS]", JSON.stringify(summary));

    // Nettoyage puis marque qu’on souhaite un reset dès que possible
    RawMemory.segments[METRICS_SEG] = "";
    RawMemory.setActiveSegments([]);
    delete Memory.evaluation;
    Memory.wantReset = true;
    console.log("[EPOCH] RCL2 reached, waiting for reset");
    return;
  }

  // ---------------------------------------------------------------------------
  // Choix d’action : greedy si EVAL, sinon ε-greedy
  // ---------------------------------------------------------------------------
  const currentState = state(room);
  const action       = brain.act(currentState, ACTIONS);
    
  if (!EVAL) Memory.evaluation.actionsTaken++;

  // ---------------------------------------------------------------------------
  // Exécution de l’action choisie
  // ---------------------------------------------------------------------------
  if (action.type === "SPAWN") {
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawn.spawnCreep(
        action.body,
        `${action.role[0].toUpperCase()}${Game.time}`,
        { memory: { role: action.role } }
      );
    }
  }

  const reward = calculateReward(room, action);

  // ---------------------------------------------------------------------------
  // Gestion des creeps + sanction si corps invalide
  // ---------------------------------------------------------------------------
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

    // Suicide si corps incomplet
    if (!creep.getActiveBodyparts(WORK) ||
        !creep.getActiveBodyparts(CARRY) ||
        !creep.getActiveBodyparts(MOVE)) {

      creep.suicide();
      if (!EVAL) brain.learn(currentState, action, -100, state(room), ACTIONS);
      continue;
    }
    creepLogic.run(creep);
  }

  // ---------------------------------------------------------------------------
  // Enregistrement du pas + apprentissage par épisode
  // ---------------------------------------------------------------------------
  const episodeComplete = brain.recordStep(currentState, action, reward);

  if (!EVAL && episodeComplete) {
    const stats = brain.learnEpisode(state(room));
    if (stats.episode % 1 === 0) {
      console.log(
        `[QLEARN] Episode ${stats.episode} | AvgR: ${stats.avgReward.toFixed(2)} | ε: ${stats.epsilon.toFixed(3)}`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Log et historique dans Memory (toutes les SAVE_EACH ticks)
  // ---------------------------------------------------------------------------
  if (Memory.epochTick % SAVE_EACH === 0) {
    Memory.evaluation.history.push({
      tick:              Game.time,
      controllerLevel:   room.controller.level,
      controllerProgress: room.controller.progress,
      harvester:         _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
      upgrader:          _.countBy(Game.creeps, c => c.memory.role).upgrader  || 0
    });
  }
  Memory.epochTick++;
};
