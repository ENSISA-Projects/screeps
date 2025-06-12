const SEG_ID      = 0;
const METRICS_SEG = 1;
const BATCH_SIZE  = 100;



const brain        = require("qlearning");
const brainBuilder = require("qlearning_builder");
const creepLogic   = require("creep");

const EVAL = !!Memory.evalMode;

// -----------------------------------------------------------------------------
// UTILITY FUNCTIONS
// -----------------------------------------------------------------------------

function generateBodyCombos(parts, maxParts) {
  const combos = [];
  function helper(startIdx, depth, buf) {
    if (depth === maxParts) { 
      combos.push(buf.slice()); 
      return; 
    }
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
  const roleCount = _.countBy(Game.creeps, c => c.memory.role);
  const harvesterCount = roleCount.harvester || 0;
  const upgraderCount = roleCount.upgrader || 0;
  const builderCount = roleCount.builder || 0;

  if (action.type === "SPAWN") {
    const bodyCost = action.body.reduce((cost, part) => {
      const partCosts = { [WORK]: 100, [CARRY]: 50, [MOVE]: 50 };
      return cost + partCosts[part];
    }, 0);
    
    if (room.energyAvailable >= bodyCost) {
      reward += 5;
      const workParts = action.body.filter(part => part === WORK).length;
      reward += workParts * 2;
      
      // Pénaliser les builders si pas assez de harvesters
      if (action.role === "builder") {
        if (harvesterCount === 0) {
          reward -= 15; // Forte pénalité si aucun harvester
          console.log("[PENALTY] Builder spawn with 0 harvesters: -15");
        } else if (harvesterCount < 2 && room.controller.level >= 2) {
          reward -= 8; // Pénalité modérée si pas assez de harvesters au RCL2+
          console.log("[PENALTY] Builder spawn with insufficient harvesters: -8");
        }
        else if (builderCount <1  && room.controller.level >= 2){
          reward -=100
        }
        
      }
      
      // Bonus pour équilibrer les rôles
      if (action.role === "harvester" && harvesterCount < 2) {
        reward += 5; // Bonus pour spawner des harvesters quand on en manque
        console.log("[BONUS] Harvester spawn when needed: +5");
      }
      
      if (action.role === "upgrader" && upgraderCount === 0 && harvesterCount >= 1) {
        reward += 3; // Bonus pour le premier upgrader si on a déjà un harvester
        console.log("[BONUS] First upgrader spawn: +3");
      }
    }
  }
  
  if (action.type === "WAIT" && room.energyAvailable >= 200) {
    reward -= 1;
  }

  // Pénalité si on a des builders mais pas d'économie stable
  if (builderCount > 0 && harvesterCount === 0) {
    reward -= 5; // Pénalité continue si builders sans harvesters
  }

  if (room.controller.progress > (Memory.lastProgress || 0)) {
    reward += 2 * (room.controller.progress - (Memory.lastProgress || 0));
  }
  Memory.lastProgress = room.controller.progress;

  return reward;
}


// -----------------------------------------------------------------------------
// MEMORY INITIALIZATION
// -----------------------------------------------------------------------------

function ensureEvaluation() {
  if (!Memory.evaluation) {
    Memory.evaluation = {
      startTick: Game.time,
      actionsTaken: 0,
      history: []
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

// -----------------------------------------------------------------------------
// BATCH LEARNING
// -----------------------------------------------------------------------------

function calculateBatchRewards(decisions) {
  const rewards = [];
  
  for (let i = 0; i < decisions.length; i++) {
    const decision = decisions[i];
    let reward = decision.immediateReward;
    
    const startProgress = decision.controllerProgress;
    const endProgress = i < decisions.length - 1 ? decisions[i + 1].controllerProgress : decision.controllerProgress;
    
    if (endProgress > startProgress) {
      reward += (endProgress - startProgress) * 2;
    }
    
    const totalCreeps = (decision.harvesterCount || 0) + (decision.upgraderCount || 0) + (decision.builderCount || 0);
    if (totalCreeps > 0 && totalCreeps <= 6) {
      reward += 1;
    }
    
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
  
  const batchRewards = calculateBatchRewards(decisions);
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
  
  if (Memory.batchLearning.totalBatches % 10 === 0) {
    console.log(`[BATCH] ${Memory.batchLearning.totalBatches} | Avg Reward: ${avgReward.toFixed(2)} | Episodes: ${(Memory.brain.stats.episodes) || 0}`);
  }
  
  Memory.batchLearning.decisions = [];
}

// -----------------------------------------------------------------------------
// INFRASTRUCTURE MANAGEMENT
// -----------------------------------------------------------------------------

function buildInfrastructure(room) {
  if (Memory.builtInfra) return;
  
  const spawn = Object.values(Game.spawns)[0];
  const controller = room.controller;
  const sources = room.find(FIND_SOURCES);

  // Build extensions
  const positions = [[2,0], [-2,0]];
  for (const [dx, dy] of positions) {
    room.createConstructionSite(spawn.pos.x + dx, spawn.pos.y + dy, STRUCTURE_EXTENSION);
  }

  // Build roads to controller
  const pathToCtrl = room.findPath(spawn.pos, controller.pos, { ignoreCreeps: true });
  for (const step of pathToCtrl) {
    room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
  }

  // Build roads to sources
  if (sources.length > 0) {
    const pathToSrc = room.findPath(spawn.pos, sources[0].pos, { ignoreCreeps: true });
    for (const step of pathToSrc) {
      room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
    }
  }

  Memory.builtInfra = true;
}

function cleanupRoom(room) {
  console.log("[CLEANUP] Removing structures and construction sites...");
  
  // Remove all construction sites
  const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
  for (const site of constructionSites) {
    site.remove();
  }
  
  // Destroy all structures except spawn and controller
  const structures = room.find(FIND_STRUCTURES);
  for (const structure of structures) {
    if (structure.structureType !== STRUCTURE_SPAWN && 
        structure.structureType !== STRUCTURE_CONTROLLER) {
      structure.destroy();
    }
  }
  
  // Remove all creeps
  for (const name in Game.creeps) {
    Game.creeps[name].suicide();
  }
  
  console.log("[CLEANUP] Room cleaned successfully");
}

// -----------------------------------------------------------------------------
// MAIN LOOP
// -----------------------------------------------------------------------------

module.exports.loop = function () {
  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  const useBuilderBrain = room.controller.level >= 2;
  const activeBrain = useBuilderBrain ? brainBuilder : brain;

  activeBrain.setFrozen(EVAL);
  ensureEvaluation();
  ensureBatchMemory();
  ensureProgressTracking();

  // Check for RCL3 completion (more robust check)
  const currentLevel = room.controller.level;
  // Force stop at RCL3 regardless of previous state
  if (currentLevel >= 3 && !Memory.waitingForReset) {
    console.log(`[RCL3 DETECTED] Current level: ${currentLevel}, stopping program`);
    
    // Calculate times if not already done
    if (!Memory.progressTracking.rcl2to3Reported) {
      Memory.progressTracking.rcl3StartTick = Game.time;
      const ticksToRcl2 = Memory.progressTracking.rcl2StartTick ? 
        (Memory.progressTracking.rcl2StartTick - Memory.progressTracking.rcl1StartTick) : 0;
      const ticksToRcl3 = Memory.progressTracking.rcl2StartTick ? 
        (Game.time - Memory.progressTracking.rcl2StartTick) : 0;
      
      console.log(`[RCL] Final progression - 1→2: ${ticksToRcl2} ticks, 2→3: ${ticksToRcl3} ticks`);
      
      // Save final metrics
      const finalMetrics = {
        ticks: Game.time - Memory.progressTracking.rcl1StartTick,
        rcl1to2: ticksToRcl2,
        rcl2to3: ticksToRcl3,
        actions: Memory.evaluation.actionsTaken || 0,
        batches: Memory.batchLearning.totalBatches || 0,
        episodes: Memory.brain.stats.episodes || 0,
        avgReward: Memory.brain.stats.avgReward || 0
      };
      
      console.log("[FINAL METRICS]", JSON.stringify(finalMetrics));
      
      // Save to segments
      RawMemory.setActiveSegments([METRICS_SEG]);
      RawMemory.segments[METRICS_SEG] = JSON.stringify(finalMetrics);
      RawMemory.setActiveSegments([]);
    }
    
    // Cleanup and prepare for reset
    cleanupRoom(room);
    
    // Reset metrics but keep Q-table
    delete Memory.evaluation;
    delete Memory.batchLearning;
    delete Memory.progressTracking;
    delete Memory.builtInfra;
    delete Memory.lastProgress;
    delete Memory.epochTick;
    Memory.waitingForReset = true;
    
    console.log("[RCL3] Program completed. Waiting for manual reset...");
    return;
  }
  
  // Normal RCL progress tracking for levels 2
  if (currentLevel !== Memory.progressTracking.lastReportedLevel) {
    if (currentLevel === 2 && !Memory.progressTracking.rcl1to2Reported) {
      Memory.progressTracking.rcl2StartTick = Game.time;
      const ticksToRcl2 = Game.time - Memory.progressTracking.rcl1StartTick;
      console.log(`[RCL] 1→2 in ${ticksToRcl2} ticks`);
      Memory.progressTracking.rcl1to2Reported = true;
    }
    Memory.progressTracking.lastReportedLevel = currentLevel;
  }

  // If waiting for reset, do nothing
  if (Memory.waitingForReset) {
    return;
  }
  
 


  // Handle reset after wipe
  if (Memory.wantReset && roomExistsAfterReset()) {
    delete Memory.wantReset;
    delete Memory.waitingForReset;
    Memory.epochTick = 0;
    
    // Reset batch learning and progress tracking
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
    
    console.log("[RESET] New epoch started");
    activeBrain.resetEpisode();
    return;
  }

  // Load brain from segments
  if (!Memory.brainLoaded) {
    RawMemory.setActiveSegments([SEG_ID]);
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        Memory.brain = JSON.parse(seg).brain;
        Memory.brainLoaded = true;
      } catch (e) {
        console.log("Error loading brain:", e);
      }
    }
    RawMemory.setActiveSegments([]);
  }

  // Build infrastructure at RCL2
  if (room.controller.level === 2) {
    buildInfrastructure(room);
  }

  // Prepare for reset at RCL2 completion
  if (room.controller.level >= 2 && !Memory.wantReset && Memory.builtInfra) {
    // Process remaining batch decisions
    if (Memory.batchLearning.decisions.length > 0) {
      processBatch();
    }
    
    // Save Q-table (only essential data)
    RawMemory.setActiveSegments([SEG_ID]);
    const compactBrain = {
      qTable: Memory.brain.qTable,
      stats: {
        episodes: Memory.brain.stats.episodes,
        avgReward: Memory.brain.stats.avgReward
      }
    };
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: compactBrain });
    RawMemory.setActiveSegments([]);
    
    console.log("[SAVE] Q-table saved, preparing for reset");
    Memory.wantReset = true;
    return;
  }
  // Define available actions based on RCL
  let ACTIONS = [];
  
  if (room.controller.level === 1) {
    const basicBody = [WORK, CARRY, MOVE];
    const ROLES = ["harvester", "upgrader"];
    ACTIONS = ROLES.map(role => ({ type: "SPAWN", role, body: basicBody }));
  } else {
    const baseParts = [WORK, CARRY, MOVE];
    const additionalParts = [WORK, CARRY, MOVE];
    const additionalCombos = generateBodyCombos(additionalParts, 2);
    
    const ALL_BODIES = additionalCombos.map(combo => baseParts.concat(combo));
    const ROLES = ["harvester", "upgrader", "builder"];
    
    ACTIONS = [];
    for (const body of ALL_BODIES) {
      for (const role of ROLES) {
        ACTIONS.push({ type: "SPAWN", role, body });
      }
    }
  }
  
  ACTIONS.push({ type: "WAIT" });

  // AI Decision Making
  const currentState = state(room);
  const action = activeBrain.act(currentState, ACTIONS);
  if (!EVAL) Memory.evaluation.actionsTaken++;

  // Execute action
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

  // Record decision for batch learning
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
    
    if (Memory.batchLearning.decisions.length >= BATCH_SIZE) {
      processBatch();
    }
  }

  // Manage creeps
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (!creep.getActiveBodyparts(WORK) ||
        !creep.getActiveBodyparts(CARRY) ||
        !creep.getActiveBodyparts(MOVE)) {
      creep.suicide();
      if (!EVAL && Memory.batchLearning.decisions.length > 0) {
        const lastDecision = Memory.batchLearning.decisions[Memory.batchLearning.decisions.length - 1];
        lastDecision.immediateReward -= 50;
      }
      continue;
    }
    creepLogic.run(creep);
  }

  activeBrain.recordStep(currentState, action, immediateReward);

  // Save history periodically (much less frequent)
  if ((Memory.epochTick || 0) % 500 === 0) {
    // Keep only essential data
    if (!Memory.evaluation.history) Memory.evaluation.history = [];
    Memory.evaluation.history.push({
      t: Game.time,
      lvl: room.controller.level,
      prog: Math.floor(room.controller.progress / 1000), // Reduce precision
      batch: Memory.batchLearning.totalBatches
    });
    
    // Limit history size
    if (Memory.evaluation.history.length > 20) {
      Memory.evaluation.history = Memory.evaluation.history.slice(-10);
    }
  }

  Memory.epochTick = (Memory.epochTick || 0) + 1;
};