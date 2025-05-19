// main-improved.js
/* ---------- paramètres ---------- */
const SEG_ID      = 0;    // segment mémoire pour Q-table
const EPOCH_TICKS = 6000;
const METRICS_SEG = 1;    // segment mémoire pour les métriques
const SAVE_EACH   = 100;
/* -------------------------------- */






function generateExactBodyCombos(parts, maxParts) {
  const combos = [];
  function helper(prefix, depth) {
    if (depth === maxParts) {
      combos.push(prefix.slice());
      return;
    }
    for (const p of parts) {
      prefix.push(p);
      helper(prefix, depth + 1);
      prefix.pop();
    }
  }
  helper([], 0);
  return combos;
}

const ALL_BODIES = generateExactBodyCombos([WORK, CARRY, MOVE], 3);
const brain       = require("qlearning");
const creepLogic  = require("creep");

const ROLES   = ["harvester", "upgrader"];
const ACTIONS = [];
for (const body of ALL_BODIES) {
  for (const role of ROLES) {
    ACTIONS.push({ type: "SPAWN", role, body });
  }
}
ACTIONS.push({ type: "WAIT" });

function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] reset, Q-learning relancé");
  brain.resetEpisode(); // Réinitialisation de l'épisode en cours
}
if (!Memory.evaluation) {
  Memory.evaluation = {
    startTick:    Game.time,
    actionsTaken: 0,
    episodeStats: [],
    history:      []
  };
}

function state(room) {
  // État enrichi: energy + creeps par rôle + niveau contrôleur
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.sum(_.filter(Game.creeps, c => c.memory.role === "harvester").map(c => c.getActiveBodyparts(WORK)));
  const u = _.sum(_.filter(Game.creeps, c => c.memory.role === "upgrader").map(c => c.getActiveBodyparts(WORK)));
  const cl = room.controller.level;
  const cp = Math.floor(room.controller.progress / 100); // progression simplifiée
  
  return `${e}|${h}|${u}|${cl}|${cp}`;
}

module.exports.loop = function () {
  if (Memory.wantReset) {
    if (Game.time % 20 === 0) console.log("[EPOCH] en attente resetUser…");
    return;
  }

  // --- restauration de la Q-table si nécessaire
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        const parsed = JSON.parse(seg);
        Memory.brain = parsed.brain;
        Memory.brainLoaded = true;
        console.log(
          `[PERSIST] Q-table restaurée |Q|=${Object.keys(parsed.brain.q).length}`
        );
      } catch (e) {
        console.log("[PERSIST] parse error (corrupted):", e);
      }
    }
    RawMemory.setActiveSegments([]);
  }

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  // --- FIN D'ÉPOQUE IMMÉDIATE : RCL2 atteint
  if (room.controller.level >= 2 && !Memory.wantReset) {
    // 1) Sauvegarde Q-table
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });

    // 2) Sauvegarde métriques
    RawMemory.setActiveSegments([METRICS_SEG]);
    RawMemory.segments[METRICS_SEG] = JSON.stringify(Memory.evaluation);

    // 3) Construis un résumé au lieu de tout dumper
    const hist = Memory.evaluation.history;
    const summary = {
      startTick:      Memory.evaluation.startTick,
      actionsTaken:   Memory.evaluation.actionsTaken,
      historyCount:   hist.length,
      episodeCount:   Memory.brain.stats.episodes,
      avgReward:      Memory.brain.stats.avgReward,
      controllerLevel: room.controller.level,
      firstEntry:     hist[0],
      lastEntry: {
        tick:               Game.time,
        controllerLevel: room.controller.level,
        controllerProgress: room.controller.progress,
        harvester:          _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
        upgrader:           _.countBy(Game.creeps, c => c.memory.role).upgrader  || 0,
      },
    };
    console.log("[METRICS]", JSON.stringify(summary));

    // 4) Vide le segment métriques pour rester < 100 KB
    RawMemory.segments[METRICS_SEG] = "";

    // 5) Désactive tout segment avant cleanup
    RawMemory.setActiveSegments([]);

    // 6) Cleanup mémoire et déclenche reset d'époque
    delete Memory.evaluation;
    Memory.wantReset = true;
    console.log("[EPOCH] RCL2 atteint, Q-table et métriques sauvegardées, attente reset");
    return;
  }

  // --- Q-learning : choix d'action de spawn
  const S = state(room);
  const A = brain.act(S, ACTIONS);
  Memory.evaluation.actionsTaken++;

  // exécution du spawn ou WAIT
  if (A.type === "SPAWN") {
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawn.spawnCreep(A.body, `${A.role[0].toUpperCase()}${Game.time}`, {
        memory: { role: A.role },
      });
    }
  }

  // exécution logique des creeps
  let anyDid = false;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

    // Vérifie si le creep peut effectuer son rôle
    const canWork = creep.getActiveBodyparts(WORK) > 0;
    const canCarry = creep.getActiveBodyparts(CARRY) > 0;
    const canMove = creep.getActiveBodyparts(MOVE) > 0;

  // Si le creep ne peut pas effectuer d'action, il se suicide
  if (!canWork | !canCarry | !canMove) {
    console.log(`[SUICIDE] Creep ${name} ne peut pas agir, il se suicide.`);
    creep.suicide();
    continue;
  }
    if (creepLogic.run(Game.creeps[name])) anyDid = true;
  }

  // calcul de la récompense
  let R = -0.1; // Pénalité de base par tick
  
  // Pénalité pour actions inutiles
  if (A.type === "SPAWN" && (!A.body.includes(MOVE) || !anyDid)) {
    R = -1;
  }
  
  // Récompenses pour avancement
  const controllerProgress = room.controller.progress;
  if (!Memory.lastProgress) Memory.lastProgress = controllerProgress;
  const progressDelta = controllerProgress - Memory.lastProgress;
  Memory.lastProgress = controllerProgress;
  
  // Bonus d'avancement du contrôleur
  if (progressDelta > 0) {
    R += progressDelta / 100; // Récompense proportionnelle à l'avancement
  }
  
  // Bonus pour l'équilibre des creeps
  const harvesters = _.filter(Game.creeps, c => c.memory.role === "harvester").length;
  const upgraders = _.filter(Game.creeps, c => c.memory.role === "upgrader").length;
  const totalCreeps = harvesters + upgraders;
  
  // Encourager un équilibre 60/40 entre harvesters et upgraders
  if (totalCreeps > 0) {
    const harvesterRatio = harvesters / totalCreeps;
    // Pénalité quadratique si on s'éloigne de 0.6
    const optimalRatio = 0.6;
    const ratioDiff = Math.abs(harvesterRatio - optimalRatio);
    R -= ratioDiff * ratioDiff * 5;
  }
  
  // Super bonus pour niveau 2
  if (room.controller.level >= 2) R += 20;

  // Enregistrement de l'action et récompense dans l'épisode en cours
  const episodeComplete = brain.recordStep(A, R);
  
  // Apprentissage si l'épisode est complet
  if (episodeComplete) {
    const S2 = state(room);
    const stats = brain.learnEpisode(S2, ACTIONS);
    
    // Enregistrer les statistiques d'épisode
    Memory.evaluation.episodeStats.push({
      tick: Game.time,
      epNum: stats.episodeCount,
      avgReward: stats.avgReward,
      qSize: stats.qSize,
      epsilon: stats.epsilon
    });
    
    // Log des statistiques
    if (stats.episodeCount % 10 === 0) {
      console.log(`[QLEARN] Épisode ${stats.episodeCount} terminé | Reward Moy: ${stats.avgReward.toFixed(2)} | ε: ${stats.epsilon.toFixed(3)} | |Q|: ${stats.qSize}`);
    }
  }

  // collecte des métriques
  if (Memory.epochTick % SAVE_EACH === 0) {
    Memory.evaluation.history.push({
      tick: Game.time,
      controllerLevel: room.controller.level,
      controllerProgress: room.controller.progress,
      harvester: _.countBy(Game.creeps, c => c.memory.role).harvester || 0,
      upgrader:  _.countBy(Game.creeps, c => c.memory.role).upgrader  || 0,
    });
  }
  Memory.epochTick++;
};