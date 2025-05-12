const SEG_ID = 0;
const SAVE_EACH = 100;
const EPOCH_TICKS = 6000;


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
const brain = require("qlearning");
const creepLogic = require("creep");

const ROLES = ["harvester", "upgrader"];
const ACTIONS = [];
for (const body of ALL_BODIES) {
  for (const role of ROLES) {
    ACTIONS.push({ type: "SPAWN", role, body });
  }
}
ACTIONS.push({ type: "WAIT" });

function roomExistsAfterReset() {
  const myRooms = Object.values(Game.rooms).filter(
    (r) => r.controller && r.controller.my
  );
  if (!myRooms.length) return false;
  const r = myRooms[0];
  return r.controller.level === 1 && _.isEmpty(Game.creeps);
}

if (Memory.epochTick === undefined) Memory.epochTick = 0;
if (Memory.wantReset && roomExistsAfterReset()) {
  delete Memory.wantReset;
  Memory.epochTick = 0;
  console.log("[EPOCH] reset, Q-learning relancé");
}

function state(room) {
  const e = room.energyAvailable >= 200 ? 1 : 0;
  const h = _.some(Game.creeps, (c) => c.memory.role === "harvester") ? 1 : 0;
  const u = _.some(Game.creeps, (c) => c.memory.role === "upgrader") ? 1 : 0;
  return `${e}${h}${u}`;
}

module.exports.loop = function () {
  if (Memory.wantReset) {
    if (Game.time % 20 === 0) console.log("[EPOCH] en attente resetUser…");
    return;
  }

  // persistance Q-table
  if (!Memory.brainLoaded) {
    const seg = RawMemory.segments[SEG_ID];
    if (typeof seg === "string" && seg.startsWith('{"brain":')) {
      try {
        const parsed = JSON.parse(seg);
        Memory.brain = parsed.brain;
        Memory.brainLoaded = true;
        console.log(
          `[PERSIST] Q-table restaurée |Q|=${
            Object.keys(parsed.brain.q).length
          }`
        );
      } catch (e) {
        console.log("[PERSIST] parse error (corrupted):", e);
      }
    }
  }

  const room = Game.rooms[Object.keys(Game.rooms)[0]];
  if (!room) return;

  if (room.controller.level >= 2 && !Memory.wantReset) {
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });
    Memory.wantReset = true;
    console.log("[EPOCH] RCL2 atteint, attente reset");
    return;
  }

  // Q-learning: choix d'action de spawn
  const S = state(room);
  const A = brain.act(S, ACTIONS);

  // exécution de SPAWN
  let spawnCode = ERR_INVALID_TARGET;
  if (A.type === "SPAWN") {
    const spawn = _.find(Game.spawns, (s) => !s.spawning);
    if (spawn && room.energyAvailable >= 200) {
      spawnCode = spawn.spawnCreep(
        A.body,
        `${A.role[0].toUpperCase()}${Game.time}`,
        { memory: { role: A.role } }
      );
    }
  }
  // WAIT ne fait rien

  // exécution logique des creeps
  let anyDid = false;
  for (const name in Game.creeps) {
    if (creepLogic.run(Game.creeps[name])) anyDid = true;
  }

  // calcul de la récompense
  let R = -0.1;
  if (A.type === "SPAWN") {
    // pénalité sévère si creep sans move (incapable d'agir)
    if (!A.body.includes(MOVE)) {
      R = -1;
    }
    if (!anyDid) {
          R = -1;
    }
  }
  // bonus pour atteindre RCL2
  if (room.controller.level >= 2) {
    R += 20;
  }

  // apprentissage
  const S2 = state(room);
  brain.learn(S, A, R, S2, ACTIONS);

  // sauvegarde périodique
  if (Game.time % SAVE_EACH === 0 && Memory.brain) {
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });
    RawMemory.setActiveSegments([]);
    console.log("[PERSIST] Q-table sauvegardée");
  }

  Memory.epochTick++;
  if (room.controller.level >= 2 || Memory.epochTick >= EPOCH_TICKS) {
    RawMemory.setActiveSegments([SEG_ID]);
    RawMemory.segments[SEG_ID] = JSON.stringify({ brain: Memory.brain });
    RawMemory.setActiveSegments([]);
    Memory.wantReset = true;
  }
};
