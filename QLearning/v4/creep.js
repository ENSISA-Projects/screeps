/******************************************************************************
 *  creep.js — episodic Q-learning for three specialised roles
 *  -------------------------------------------------------------------
 *  Each creep carries its own Q-table and learns via *episodic* updates
 *  (back-propagating rewards once every `EPISODE_LENGTH` steps).
 *
 *  Supported roles & action sets
 *  ─────────────────────────────
 *    • **Harvester** – ["HARVEST", "TRANSFER"]
 *    • **Upgrader**  – ["WITHDRAW", "UPGRADE"]
 *    • **Builder**   – ["WITHDRAW", "BUILD", "REPAIR"]
 *
 *  Episode flow (per creep)
 *  ------------------------
 *    1. Encode a 5-bit context state:
 *         hasEnergy · canWork · nearSource · nearTarget · nearConstruction
 *    2. If the current action is finished, record a final bonus and pick a
 *       new action with ε-greedy policy (`brainLogic.act`).
 *    3. Execute the action; set **did** when WORK/CARRY succeeds.
 *    4. Shape an immediate reward with `computeReward` (context-sensitive).
 *    5. Push (s, a, r) into the episode buffer; when `EPISODE_LENGTH`
 *       steps elapsed call `learnEpisode`, which:
 *         • walks backward through the buffer,
 *         • applies one-step Q-learning updates with `brainLogic.learn`,
 *         • decays ε, and
 *         • updates per-role statistics in `Memory.creepStats`.
 ******************************************************************************/

const brainLogic = require("creep.brain");

const HARVESTER_ACTIONS = ["HARVEST", "TRANSFER"];
const UPGRADER_ACTIONS = ["WITHDRAW", "UPGRADE"];
const BUILDER_ACTIONS = ["WITHDRAW", "BUILD", "REPAIR"];
const EPISODE_LENGTH = 10; // Actions per episode

function findSource(creep) {
  return creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
}

function findDepositTarget(creep) {
  return creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s) =>
      (((s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION) &&
        s.my) ||
        s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });
}

function findWithdrawSource(creep) {
  // for upgrader/builder withdraw from storage|spawn|extension|container
  return creep.pos.findClosestByPath(FIND_STRUCTURES, {
    filter: (s) =>
      (((s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION) &&
        s.my) ||
        s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
      s.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
  });
}

function findController(creep) {
  return creep.room.controller;
}

function findConstructionSite(creep) {
  return creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
}

function findRepairTarget(creep) {
  // Look for structures that need repair
  const targets = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.hits < s.hitsMax &&
      s.structureType !== STRUCTURE_WALL &&
      s.structureType !== STRUCTURE_RAMPART,
  });

  if (targets.length > 0) {
    // Prioritize the most damaged structures
    return targets.sort((a, b) => a.hits / a.hitsMax - b.hits / b.hitsMax)[0];
  }
  return null;
}

function computeReward(creep, action, did, prevState, currentState) {
  let reward = did ? 1 : -1; // Base reward

  // Context-specific to the action
  if (action === "HARVEST") {
    // + 1 if harvested energy
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (currEnergy > prevEnergy) reward += 1;
    // - 2 if nothing to harvest
    if (prevEnergy === 1 && action === "HARVEST") reward -= 2;
  } else if (action === "TRANSFER") {
    // + 2 if transfer successful (empty carry)
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (prevEnergy === 1 && currEnergy === 0) reward += 2;
    // - 2 if nothing to transfer
    if (prevEnergy === 0 && action === "TRANSFER") reward -= 2;
  } else if (action === "WITHDRAW") {
    // + 2 if energy retrieved
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (prevEnergy === 0 && currEnergy === 1) reward += 2;

    // - 2 if already full
    if (prevEnergy === 1 && action === "WITHDRAW") reward -= 2;
  } else if (action === "UPGRADE") {
    // + 1 if controller upgraded
    if (did) reward += 1;

    // - 2 if no energy
    const energy = parseInt(currentState.charAt(0));
    if (energy === 0 && action === "UPGRADE") reward -= 2;
  } else if (action === "BUILD") {
    // + 3 if construction successful
    if (did) reward += 3;

    // - 2 if no energy
    const energy = parseInt(currentState.charAt(0));
    if (energy === 0 && action === "BUILD") reward -= 2;
  } else if (action === "REPAIR") {
    // + 2 if repaired
    if (did) reward += 2;

    // - 2 if no energy
    const energy = parseInt(currentState.charAt(0));
    if (energy === 0 && action === "REPAIR") reward -= 2;
  }

  return reward;
}

function creepState(creep) {
  // states [hasEnergy, canWork, nearSource, nearTarget, nearConstruction]
  const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 ? 1 : 0;
  const canWork = creep.getActiveBodyparts(WORK) > 0 ? 1 : 0;
  const nearSource = creep.pos.findInRange(FIND_SOURCES, 3).length > 0 ? 1 : 0;

  let nearTarget = 0;
  let nearConstruction = 0;

  if (creep.memory.role === "harvester") {
    const target = findDepositTarget(creep);
    nearTarget = target && creep.pos.getRangeTo(target) <= 3 ? 1 : 0;
  } else if (creep.memory.role === "upgrader") {
    const ctrl = creep.room.controller;
    nearTarget = ctrl && creep.pos.getRangeTo(ctrl) <= 3 ? 1 : 0;
  } else if (creep.memory.role === "builder") {
    const constructionSite = findConstructionSite(creep);
    nearConstruction =
      constructionSite && creep.pos.getRangeTo(constructionSite) <= 3 ? 1 : 0;

    const repairTarget = findRepairTarget(creep);
    nearTarget =
      repairTarget && creep.pos.getRangeTo(repairTarget) <= 3 ? 1 : 0;
  }

  return `${hasEnergy}${canWork}${nearSource}${nearTarget}${nearConstruction}`;
}

module.exports.run = function (creep) {
  // select actions based on role
  const role = creep.memory.role;
  let actions;

  switch (role) {
    case "harvester":
      actions = HARVESTER_ACTIONS;
      break;
    case "upgrader":
      actions = UPGRADER_ACTIONS;
      break;
    case "builder":
      actions = BUILDER_ACTIONS;
      break;
    default:
      actions = HARVESTER_ACTIONS;
  }

  // init brain & episode
  if (!creep.memory.brain) {
    creep.memory.brain = {
      q: {},
      alpha: 0.2,
      gamma: 0.9,
      epsilon: 0.5,
      minEpsilon: 0.1,
      epsilonDecay: 0.999,
    };
  }

  if (!creep.memory.episode) {
    creep.memory.episode = {
      states: [],
      actions: [],
      rewards: [],
      step: 0,
    };
  }

  // store previous and current state
  const currentState = creepState(creep);
  const prevState = creep.memory.prevState || currentState;
  creep.memory.prevState = currentState;

  // determine if action completed
  const freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const usedEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  let doneHarvest = false,
    doneTransfer = false;
  let doneWithdraw = false,
    doneUpgrade = false;
  let doneBuild = false,
    doneRepair = false;

  if (actions.includes("HARVEST")) doneHarvest = freeCap === 0;
  if (actions.includes("TRANSFER")) doneTransfer = usedEnergy === 0;
  if (actions.includes("WITHDRAW")) doneWithdraw = usedEnergy > 0;
  if (actions.includes("UPGRADE")) doneUpgrade = usedEnergy === 0;
  if (actions.includes("BUILD"))
    doneBuild = usedEnergy === 0 || !findConstructionSite(creep);
  if (actions.includes("REPAIR"))
    doneRepair = usedEnergy === 0 || !findRepairTarget(creep);

  // select or maintain action
  let action = creep.memory.currentAction;
  const isDone =
    (action === "HARVEST" && doneHarvest) ||
    (action === "TRANSFER" && doneTransfer) ||
    (action === "WITHDRAW" && doneWithdraw) ||
    (action === "UPGRADE" && doneUpgrade) ||
    (action === "BUILD" && doneBuild) ||
    (action === "REPAIR" && doneRepair);

  if (!action || isDone) {
    // Save the current state in the episode
    creep.memory.episode.states[creep.memory.episode.step] = currentState;

    // Choose a new action
    action = brainLogic.act(currentState, actions, creep.memory.brain);
    creep.memory.currentAction = action;

    // If the previous action is done, save the final reward
    if (creep.memory.lastAction && isDone) {
      const finalReward = 2;
      recordReward(creep, creep.memory.lastAction, finalReward);
    }

    creep.memory.lastAction = action;
  }

  // execute action
  let did = false;
  if (action === "HARVEST") {
    if (freeCap > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const src = findSource(creep);
      if (src) {
        const code = creep.harvest(src);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(src, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    }
  } else if (action === "TRANSFER") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(CARRY) > 0) {
      const tgt = findDepositTarget(creep);
      if (tgt) {
        const code = creep.transfer(tgt, RESOURCE_ENERGY);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(tgt, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    }
  } else if (action === "WITHDRAW") {
    if (freeCap > 0 && creep.getActiveBodyparts(CARRY) > 0) {
      const src = findWithdrawSource(creep);
      if (src) {
        const code = creep.withdraw(src, RESOURCE_ENERGY);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(src, { visualizePathStyle: { stroke: "#ffaa00" } });
      }
    }
  } else if (action === "UPGRADE") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const ctrl = findController(creep);
      if (ctrl) {
        const code = creep.upgradeController(ctrl);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(ctrl, { visualizePathStyle: { stroke: "#ffffff" } });
      }
    }
  } else if (action === "BUILD") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const site = findConstructionSite(creep);
      if (site) {
        const code = creep.build(site);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(site, { visualizePathStyle: { stroke: "#00ff00" } });
      }
    }
  } else if (action === "REPAIR") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const target = findRepairTarget(creep);
      if (target) {
        const code = creep.repair(target);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE)
          creep.moveTo(target, { visualizePathStyle: { stroke: "#0000ff" } });
      }
    }
  }

  // Compute reward and record step
  const reward = computeReward(creep, action, did, prevState, currentState);
  const episodeComplete = recordStep(creep, action, reward);

  // If the episode is complete, learn
  if (episodeComplete) {
    learnEpisode(creep, actions);
  }

  // clear when done
  if (isDone) delete creep.memory.currentAction;
  return did;
};

function recordStep(creep, action, reward) {
  const episode = creep.memory.episode;
  const step = episode.step;

  // Save action and reward
  episode.actions[step] = action;
  episode.rewards[step] = reward;
  episode.step++;

  // Check if the episode is complete
  return episode.step >= EPISODE_LENGTH;
}

function recordReward(creep, action, reward) {
  // Add an additional reward to the last action
  const episode = creep.memory.episode;
  const lastIdx = Math.max(0, episode.step - 1);

  if (episode.actions[lastIdx] === action) {
    episode.rewards[lastIdx] += reward;
  }
}

function learnEpisode(creep, actions) {
  const brain = creep.memory.brain;
  const episode = creep.memory.episode;
  const currentState = creepState(creep);

  // Learning from the episode
  for (let i = episode.step - 1; i >= 0; i--) {
    const s = episode.states[i];
    const a = episode.actions[i];
    const r = episode.rewards[i];

    // Next state is the current state for the last step
    // or the next state in the episode for all others
    const s2 = i === episode.step - 1 ? currentState : episode.states[i + 1];

    // standard Q-learning
    brainLogic.learn(s, a, r, s2, actions, brain);
  }

  // Reset the episode for the next cycle
  creep.memory.episode = {
    states: [],
    actions: [],
    rewards: [],
    step: 0,
  };

  // Stats
  if (!Memory.creepStats) Memory.creepStats = {};
  if (!Memory.creepStats[creep.memory.role]) {
    Memory.creepStats[creep.memory.role] = {
      episodes: 0,
      totalReward: 0,
      recentRewards: [],
    };
  }

  const stats = Memory.creepStats[creep.memory.role];
  const totalReward = _.sum(episode.rewards);
  stats.episodes++;
  stats.totalReward += totalReward;

  // Keep a history of recent rewards
  stats.recentRewards.push(totalReward);
  if (stats.recentRewards.length > 20) stats.recentRewards.shift();

  // Adjust epsilon based on recent performance
  if (stats.episodes % 10 === 0 && stats.recentRewards.length >= 5) {
    const avgReward = _.sum(stats.recentRewards) / stats.recentRewards.length;

    // If rewards are stable or decreasing, increase exploration
    if (avgReward < 0 && brain.epsilon < 0.4) {
      brain.epsilon = Math.min(0.5, brain.epsilon * 1.1);
      console.log(
        `[CREEP:${
          creep.memory.role
        }] Augmentation exploration ε=${brain.epsilon.toFixed(2)}`
      );
    }

    // Show stats
    console.log(
      `[CREEP:${creep.memory.role}] ${stats.episodes} episodes | ` +
        `Average Reward: ${avgReward.toFixed(2)} | ε: ${brain.epsilon.toFixed(
          2
        )} | ` +
        `|Q|: ${Object.keys(brain.q).length}`
    );
  }
}
