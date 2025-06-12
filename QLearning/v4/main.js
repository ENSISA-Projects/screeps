const SEG_ID      = 0;
const METRICS_SEG = 1;
const EPOCH_TICKS = 6000;
const SAVE_EACH   = 100;
const BATCH_SIZE  = 100; // Nouvelle constante pour le batch learning


const brain        = require("qlearning");           // Q-learning de base (RCL1)
const brainBuilder = require("qlearning_builder");   // Q-learning avancé (RCL2+)
const creepLogic   = require("creep");

const EVAL = !!Memory.evalMode;

// -----------------------------------------------------------------------------
function generateBodyCombos(parts, maxParts) {
  const combos = [];
  function helper(startIdx, depth, buf) {
    if (depth === maxParts) { combos.push(buf.slice()); return; }
    for (let i = startIdx; i < parts.length; i++) {
      buf.push(parts[i]);
      helper(i, depth + 1, buf);
      buf.pop();
    }
  }
  helper(0, 0, []);
  return combos;
}

function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(r => r.controller && r.controller.my);
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

function state(room) {
  const energyStatus   = room.energyAvailable >= 200 ? 1 : 0;
  const roleCount      = _.countBy(Game.creeps, c => c.memory.role);
  const harvesterCount = roleCount.harvester || 0;
  const upgraderCount  = roleCount.upgrader  || 0;
  const builderCount   = roleCount.builder   || 0;
  return `${energyStatus}|${harvesterCount}|${upgraderCount}|${builderCount}`;
}

function calculateReward(room, action) {
  let reward = -1;

  if (action.type === "SPAWN") {
    const bodyCost = action.body.reduce((cost, part) => {
      const partCosts = { [WORK]: 100, [CARRY]: 50, [MOVE]: 50 };
      return cost + partCosts[part];
    }, 0);
    
    if (room.energyAvailable >= bodyCost) {
      reward += 5;
      // Bonus pour les bots plus efficaces (plus de WORK)
      const workParts = action.body.filter(part => part === WORK).length;
      reward += workParts * 2;
    }
  }
  
  if (action.type === "WAIT" && room.energyAvailable >= 200) reward -= 1;

  if (room.controller.progress > (Memory.lastProgress || 0)) {
    reward += (room.controller.progress - (Memory.lastProgress || 0));
  }
  Memory.lastProgress = room.controller.progress;

  return reward;
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

function ensureBatchMemory() {
  if (!Memory.batchLearning) {
    Memory.batchLearning = {
      decisions: [],
      batchCount: 0,
      totalBatches: 0
    };
  }
}

function ensureProgressTracking() {
  if (!Memory.progressTracking) {
    Memory.progressTracking = {
      rcl1StartTick: Game.time,
      rcl2StartTick: null,
      rcl3StartTick: null,
      rcl1to2Reported: false,
      rcl2to3Reported: false,
      lastReportedLevel: 1
    };
  }
}

function calculateBatchRewards(decisions) {
  // Calcule les récompenses pour chaque décision du batch
  const rewards = [];
  
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    let reward = decision.immediateReward;
    
    // Ajouter des récompenses basées sur les résultats à long terme
    const startProgress = decision.controllerProgress;
    const endProgress = i < decisions.length - 1 ? decisions[i + 1].controllerProgress : decision.controllerProgress;
    
    // Récompense pour l'amélioration du contrôleur
    if (endProgress > startProgress) {
      reward += (endProgress - startProgress) * 2;
    }
    
    // Bonus pour maintenir un équilibre de creeps
    const totalCreeps = (decision.harvesterCount || 0) + (decision.upgraderCount || 0) + (decision.builderCount || 0);
    if (totalCreeps > 0 && totalCreeps <= 6) {
      reward += 1; // Bonus pour un nombre optimal de creeps
    }
    
    // Pénalité pour trop de creeps
    if (totalCreeps > 8) {
      reward -= 2;
    }
    
    rewards.push(reward);
  }
  
  return rewards;
}

function processBatch() {
  const decisions = Memory.batchLearning.decisions;
  if (decisions.length < BATCH_SIZE) return;
  
  // Calcule les récompenses pour tout le batch
  const batchRewards = calculateBatchRewards(decisions);
  
  // Applique l'apprentissage pour chaque décision avec sa récompense calculée
  const useBuilderBrain = decisions[0].controllerLevel >= 2;
  const activeBrain = useBuilderBrain ? brainBuilder : brain;
  
  let totalReward = 0;
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    const reward = batchRewards[i];
    const nextState = i < decisions.length - 1 ? decisions[i + 1].state : decision.state;
    
    if (!EVAL) {
      activeBrain.learn(decision.state, decision.action, reward, nextState, decision.availableActions);
    }
    
    totalReward += reward;
  }
  
  const avgReward = totalReward / decisions.length;
  Memory.batchLearning.batchCount++;
  Memory.batchLearning.totalBatches++;
  
  // Log périodique des performances (toutes les 10 épisodes)
  if (Memory.batchLearning.totalBatches % 10 === 0) {
console.log(`[PERF] Batch ${Memory.batchLearning.totalBatches} | Récompense moyenne: ${avgReward.toFixed(2)} | Episodes: ${(Memory.brain && Memory.brain.stats && Memory.brain.stats.episodes) || 0}`);
  }
  
  // Reset pour le prochain batch
  Memory.batchLearning.decisions = [];
}

// -----------------------------------------------------------------------------
module.exports.loop = function () {
  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  const useBuilderBrain = room.controller.level >= 2;
  const activeBrain     = useBuilderBrain ? brainBuilder : brain;

  activeBrain.setFrozen(EVAL);
  ensureEvaluation();
  ensureBatchMemory();
  ensureProgressTracking();

  // Suivi des progressions RCL
  const currentLevel = room.controller.level;
  if (currentLevel !== Memory.progressTracking.lastReportedLevel) {
    if (currentLevel === 2 && !Memory.progressTracking.rcl1to2Reported) {
      Memory.progressTracking.rcl2StartTick = Game.time;
      const ticksToRcl2 = Game.time - Memory.progressTracking.rcl1StartTick;
      console.log(`[RCL] 1→2 en ${ticksToRcl2} ticks`);
      Memory.progressTracking.rcl1to2Reported = true;
    } else if (currentLevel === 3 && !Memory.progressTracking.rcl2to3Reported) {
      Memory.progressTracking.rcl3StartTick = Game.time;
      const ticksToRcl3 = Game.time - (Memory.progressTracking.rcl2StartTick || Game.time);
      console.log(`[RCL] 2→3 en ${ticksToRcl3} ticks`);
      Memory.progressTracking.rcl2to3Reported = true;
      // Arrêt du programme après RCL3
      console.log(`[STOP] Programme terminé après RCL3`);
      return;
    }
    Memory.progressTracking.lastReportedLevel = currentLevel;
  }

  // Reset complet après wipe
  if (Memory.wantReset && roomExistsAfterReset()) {
    delete Memory.wantReset;
    Memory.epochTick = 0;
    // Reset aussi le batch learning et le tracking
    Memory.batchLearning = {
      decisions: [],
      batchCount: 0,
      totalBatches: 0
    };
    Memory.progressTracking = {
      rcl1StartTick: Game.time,
      rcl2StartTick: null,
      rcl3StartTick: null,
      rcl1to2Reported: false,
      rcl2to3Reported: false,
      lastReportedLevel: 1
    };
    console.log("[EPOCH] Reset complete");
    activeBrain.resetEpisode();
    return;
  }

  // Chargement initial
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        Memory.brain = JSON.parse(seg).brain;
        Memory.brainLoaded = true;
      } catch (e) {}
    }
    RawMemory.setActiveSegments([]);
  }

  // Construction automatique à RCL2
  if (room.controller.level === 2 && !Memory.builtInfra) {
    const spawn = Object.values(Game.spawns)[0];
    const controller = room.controller;
    const sources = room.find(FIND_SOURCES);

    const positions = [[2,0], [-2,0], [0,2], [0,-2], [2,2]];
    for (const [dx, dy] of positions) {
      room.createConstructionSite(spawn.pos.x + dx, spawn.pos.y + dy, STRUCTURE_EXTENSION);
    }

    const pathToCtrl = room.findPath(spawn.pos, controller.pos, { ignoreCreeps: true });
    for (const step of pathToCtrl) {
      room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
    }

    if (sources.length > 0) {
      const pathToSrc = room.findPath(spawn.pos, sources[0].pos, { ignoreCreeps: true });
      for (const step of pathToSrc) {
        room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
      }
    }

    Memory.builtInfra = true;
  }

  // Reset auto à RCL2
  if (room.controller.level >= 2 && !Memory.wantReset && !Memory.builtInfra) {
    // Traite le dernier batch avant le reset
    if (Memory.batchLearning.decisions.length > 0) {
      processBatch();
    }
    
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });

    RawMemory.setActiveSegments([METRICS_SEG]);
    RawMemory.segments[METRICS_SEG] = JSON.stringify(Memory.evaluation);

    const hist = Memory.evaluation.history;
    const summary = {
      startTick: Memory.evaluation.startTick,
      actionsTaken: Memory.evaluation.actionsTaken,
      historyCount: hist.length,
      episodeCount: Memory.brain.stats.episodes,
      avgReward: Memory.brain.stats.avgReward,
      controllerLevel: room.controller.level,
      totalBatches: Memory.batchLearning.totalBatches,
      firstEntry: hist[0],
      lastEntry: {
        tick: Game.time,
        controllerLevel: room.controller.level,
        controllerProgress: room.controller.progress,
        ..._.countBy(Game.creeps, c => c.memory.role)
      }
    };

    console.log("[METRICS]", JSON.stringify(summary));
    RawMemory.setActiveSegments([]);
    delete Memory.evaluation;
    Memory.wantReset = true;
    return;
  }

  // Corps + rôles dynamiques
  let ACTIONS = [];
  
  if (room.controller.level === 1) {
    // RCL1: Un seul type de bot [WORK, CARRY, MOVE]
    const basicBody = [WORK, CARRY, MOVE];
    const ROLES = ["harvester", "upgrader"];
    ACTIONS = ROLES.map(role => ({ type: "SPAWN", role, body: basicBody }));
  } else {
    // RCL2+: Base [WORK, CARRY, MOVE] + 2 parties supplémentaires choisies par Q-learning
    const baseParts = [WORK, CARRY, MOVE];
    const additionalParts = [WORK, CARRY, MOVE]; // Pool pour les 2 parties supplémentaires
    const additionalCombos = generateBodyCombos(additionalParts, 2);
    
    const ALL_BODIES = [];
    for (let i = 0; i < additionalCombos.length; i++) {
      const fullBody = baseParts.concat(additionalCombos[i]);
      ALL_BODIES.push(fullBody);
    }
    
    const ROLES = ["harvester", "upgrader", "builder"];
    
    ACTIONS = [];
    for (let i = 0; i < ALL_BODIES.length; i++) {
      for (let j = 0; j < ROLES.length; j++) {
        ACTIONS.push({ type: "SPAWN", role: ROLES[j], body: ALL_BODIES[i] });
      }
    }
  }
  
  ACTIONS.push({ type: "WAIT" });

  const currentState = state(room);
  const action = activeBrain.act(currentState, ACTIONS);
  if (!EVAL) Memory.evaluation.actionsTaken++;

  // Exécution de l'action
  if (action.type === "SPAWN") {
    const spawn = _.find(Game.spawns, s => !s.spawning);
    if (spawn) {
      const bodyCost = action.body.reduce((cost, part) => {
        const partCosts = { [WORK]: 100, [CARRY]: 50, [MOVE]: 50 };
        return cost + partCosts[part];
      }, 0);
      
      if (room.energyAvailable >= bodyCost) {
        spawn.spawnCreep(
          action.body,
          `${action.role[0].toUpperCase()}${Game.time}`,
          { memory: { role: action.role } }
        );
      }
    }
  }

  const immediateReward = calculateReward(room, action);

  // Enregistre la décision dans le batch
  const roleCount = _.countBy(Game.creeps, c => c.memory.role);
  const decision = {
    tick: Game.time,
    state: currentState,
    action: action,
    availableActions: ACTIONS,
    immediateReward: immediateReward,
    controllerLevel: room.controller.level,
    controllerProgress: room.controller.progress,
    energyAvailable: room.energyAvailable,
    harvesterCount: roleCount.harvester || 0,
    upgraderCount: roleCount.upgrader || 0,
    builderCount: roleCount.builder || 0
  };

  if (!EVAL) {
    Memory.batchLearning.decisions.push(decision);
    
    // Traite le batch quand il est plein
    if (Memory.batchLearning.decisions.length >= BATCH_SIZE) {
      processBatch();
    }
  }

  // Gestion des creeps
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep.getActiveBodyparts(WORK) ||
        !creep.getActiveBodyparts(CARRY) ||
        !creep.getActiveBodyparts(MOVE)) {
      creep.suicide();
      // Pénalité immédiate pour creep défaillant (sera incluse dans le batch)
      if (!EVAL && Memory.batchLearning.decisions.length > 0) {
        const lastDecision = Memory.batchLearning.decisions[Memory.batchLearning.decisions.length - 1];
        lastDecision.immediateReward -= 50;
      }
      continue;
    }
    creepLogic.run(creep);
  }

  // L'apprentissage épisodique est maintenant remplacé par le batch learning
  // On garde juste le recordStep pour la compatibilité
  activeBrain.recordStep(currentState, action, immediateReward);

  // Historique
  if (Memory.epochTick % SAVE_EACH === 0) {
    Memory.evaluation.history.push({
      tick: Game.time,
      controllerLevel: room.controller.level,
      controllerProgress: room.controller.progress,
      batchesProcessed: Memory.batchLearning.totalBatches,
      currentBatchSize: Memory.batchLearning.decisions.length,
      ..._.countBy(Game.creeps, c => c.memory.role)
    });
  }

  Memory.epochTick++;
};