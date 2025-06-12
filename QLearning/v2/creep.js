/******************************************************************************
 *  creep.js — Q-learning for action **sequences**
 *  --------------------------------------------------------
 *  Each creep keeps its *own* tiny Q-table in `creep.memory.brain`.
 *  Two finite action-sets are supported:
 *
 *        Harvester :  [ "HARVEST",  "TRANSFER" ]
 *        Upgrader  :  [ "WITHDRAW", "UPGRADE"  ]
 *
 *  Design highlights
 *  -----------------
 *   •  **Context-aware rewards** (`computeReward`) encourage good sequences,
 *      penalise useless orders, and give bonuses when an action finishes.
 *   •  **Per-creep episodes** of fixed length (`EPISODE_LENGTH` = 10 steps)
 *      are gathered and then learned via backward Q-updates (`learnEpisode`).
 *   •  ε (exploration) is auto-adjusted per role when recent rewards stagnate.
 ******************************************************************************/

const brainLogic = require("creep.brain");

const HARVESTER_ACTIONS = ["HARVEST", "TRANSFER"];
const UPGRADER_ACTIONS = ["WITHDRAW", "UPGRADE"];
const EPISODE_LENGTH = 10; // Steps per episode

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
  // Upgrader withdraw from storage|spawn|extension|container
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

function computeReward(creep, action, did, prevState, currentState) {
  // Base reward
  let reward = did ? 1 : -1;

  // Specific rewards based on action
  if (action === "HARVEST") {
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (currEnergy > prevEnergy) reward += 1;
    // - if nothing to harvest
    if (prevEnergy === 1 && action === "HARVEST") reward -= 2;
  } else if (action === "TRANSFER") {
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (prevEnergy === 1 && currEnergy === 0) reward += 2;
    // - if nothing to transfer
    if (prevEnergy === 0 && action === "TRANSFER") reward -= 2;
  } else if (action === "WITHDRAW") {
    const prevEnergy = parseInt(prevState.charAt(0));
    const currEnergy = parseInt(currentState.charAt(0));
    if (prevEnergy === 0 && currEnergy === 1) reward += 2;
    // - if already full
    if (prevEnergy === 1 && action === "WITHDRAW") reward -= 2;
  } else if (action === "UPGRADE") {
    if (did) reward += 1;
    // - if no energy
    const energy = parseInt(currentState.charAt(0));
    if (energy === 0 && action === "UPGRADE") reward -= 2;
  }

  return reward;
}

// States [hasEnergy, canWork, nearSource, nearTarget]
function creepState(creep) {
  const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 ? 1 : 0;
  const canWork = creep.getActiveBodyparts(WORK) > 0 ? 1 : 0;
  const nearSource = creep.pos.findInRange(FIND_SOURCES, 3).length > 0 ? 1 : 0;

  let nearTarget = 0;
  if (creep.memory.role === "harvester") {
    const target = findDepositTarget(creep);
    nearTarget = target && creep.pos.getRangeTo(target) <= 3 ? 1 : 0;
  } else if (creep.memory.role === "upgrader") {
    const ctrl = creep.room.controller;
    nearTarget = ctrl && creep.pos.getRangeTo(ctrl) <= 3 ? 1 : 0;
  }

  return `${hasEnergy}${canWork}${nearSource}${nearTarget}`;
}

module.exports.run = function (creep) {
  // Select actions based on role
  const role = creep.memory.role;
  const actions = role === "harvester" ? HARVESTER_ACTIONS : UPGRADER_ACTIONS;

  // Init brain & episode
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

  // Calculate contextual reward
  const currentState = creepState(creep);
  const prevState = creep.memory.prevState || currentState;
  creep.memory.prevState = currentState;

  // Determine if action completed
  const freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const usedEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  let doneHarvest = false,
    doneTransfer = false;
  let doneWithdraw = false,
    doneUpgrade = false;
  if (actions.includes("HARVEST")) doneHarvest = freeCap === 0;
  if (actions.includes("TRANSFER")) doneTransfer = usedEnergy === 0;
  if (actions.includes("WITHDRAW")) doneWithdraw = usedEnergy > 0;
  if (actions.includes("UPGRADE")) doneUpgrade = usedEnergy === 0;

  // Select or maintain action
  let action = creep.memory.currentAction;
  const isDone =
    (action === "HARVEST" && doneHarvest) ||
    (action === "TRANSFER" && doneTransfer) ||
    (action === "WITHDRAW" && doneWithdraw) ||
    (action === "UPGRADE" && doneUpgrade);

  if (!action || isDone) {
    // Save current state in episode
    creep.memory.episode.states[creep.memory.episode.step] = currentState;

    // Choose a new action
    action = brainLogic.act(currentState, actions, creep.memory.brain);
    creep.memory.currentAction = action;

    // If previous action is done, save final reward
    if (creep.memory.lastAction && isDone) {
      const finalReward = 2;
      recordReward(creep, creep.memory.lastAction, finalReward);
    }

    creep.memory.lastAction = action;
  }

  // Execute action
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
  }

  // Calculate and record reward
  const reward = computeReward(creep, action, did, prevState, currentState);
  const episodeComplete = recordStep(creep, action, reward);

  // If episode is complete, learn
  if (episodeComplete) {
    learnEpisode(creep, actions);
  }

  // Clear on done
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

  // Check if episode is complete
  return episode.step >= EPISODE_LENGTH;
}

function recordReward(creep, action, reward) {
  // Add extra reward for last action
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

  // Learning from the end to the start (backward view)
  for (let i = episode.step - 1; i >= 0; i--) {
    const s = episode.states[i];
    const a = episode.actions[i];
    const r = episode.rewards[i];

    // Next state is either the next one in the episode, or the current state
    const s2 = i === episode.step - 1 ? currentState : episode.states[i + 1];

    brainLogic.learn(s, a, r, s2, actions, brain);
  }

  // Reset episode for next cycle
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

  // Keep track of recent rewards
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
        `Avg Reward: ${avgReward.toFixed(2)} | ε: ${brain.epsilon.toFixed(
          2
        )} | ` +
        `|Q|: ${Object.keys(brain.q).length}`
    );
  }
}
