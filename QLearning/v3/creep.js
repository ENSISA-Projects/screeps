/******************************************************************************
 *  creep.js — per-creep Q-learning runner
 *  --------------------------------------
 *  Each creep stores its own brain in `creep.memory.brain`
 *  (independent Q-table, α, γ, ε).
 *
 *  Action sets
 *  ───────────
 *    • **Harvester** :  [ "HARVEST",  "TRANSFER" ]
 *    • **Upgrader**  :  [ "WITHDRAW", "UPGRADE"  ]
 *
 *  Tick flow for a single creep
 *  ----------------------------
 *    1.  Build a 2-bit state “hasEnergy canWork”.
 *    2.  Decide whether the current action finished (e.g. carry is full).
 *    3.  If finished or none chosen yet → ε-greedy pick via `brain.act()`.
 *    4.  Execute the action (move or work), set **did** flag if work done.
 *    5.  Reward = +1 if **did**, −1 otherwise.
 *    6.  Q-update with `brain.learn()`.
 ******************************************************************************/

const brain = require("creep.brain");

const HARVESTER_ACTIONS = ["HARVEST", "TRANSFER"];
const UPGRADER_ACTIONS = ["WITHDRAW", "UPGRADE"];

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
  // for upgrader: withdraw from storage/spawn/extension/container
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

function computeReward(creep, action, did) {
  // +1 if did something, -1 otherwise
  return did ? 1 : -1;
}

function creepState(creep) {
  // state: [hasEnergy, canWork]
  const hasEnergy = creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 ? 1 : 0;
  const canWork = creep.getActiveBodyparts(WORK) > 0 ? 1 : 0;
  return `${hasEnergy}${canWork}`;
}

module.exports.run = function (creep) {
  // select actions based on role
  const role = creep.memory.role;
  const actions = role === "harvester" ? HARVESTER_ACTIONS : UPGRADER_ACTIONS;

  // init brain
  if (!creep.memory.brain) {
    creep.memory.brain = { q: {}, alpha: 0.2, gamma: 0.9, epsilon: 0.5 };
  }

  // current state
  const S = creepState(creep);

  // determine if action completed
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

  // select or maintain action
  let action = creep.memory.currentAction;
  const isDone =
    (action === "HARVEST" && doneHarvest) ||
    (action === "TRANSFER" && doneTransfer) ||
    (action === "WITHDRAW" && doneWithdraw) ||
    (action === "UPGRADE" && doneUpgrade);
  if (!action || isDone) {
    action = brain.act(S, actions, creep.memory.brain);
    creep.memory.currentAction = action;
  }

  // execute action
  let did = false;
  if (action === "HARVEST") {
    if (freeCap > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const src = findSource(creep);
      if (src) {
        const code = creep.harvest(src);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE) creep.moveTo(src);
      }
    }
  } else if (action === "TRANSFER") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(CARRY) > 0) {
      const tgt = findDepositTarget(creep);
      if (tgt) {
        const code = creep.transfer(tgt, RESOURCE_ENERGY);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE) creep.moveTo(tgt);
      }
    }
  } else if (action === "WITHDRAW") {
    if (freeCap > 0 && creep.getActiveBodyparts(CARRY) > 0) {
      const src = findWithdrawSource(creep);
      if (src) {
        const code = creep.withdraw(src, RESOURCE_ENERGY);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE) creep.moveTo(src);
      }
    }
  } else if (action === "UPGRADE") {
    if (usedEnergy > 0 && creep.getActiveBodyparts(WORK) > 0) {
      const ctrl = findController(creep);
      if (ctrl) {
        const code = creep.upgradeController(ctrl);
        if (code === OK) did = true;
        else if (code === ERR_NOT_IN_RANGE) creep.moveTo(ctrl);
      }
    }
  }

  // learn
  const S2 = creepState(creep);
  const reward = computeReward(creep, action, did);
  brain.learn(S, action, reward, S2, actions, creep.memory.brain);

  // clear on done
  if (isDone) delete creep.memory.currentAction;
  return did;
};
