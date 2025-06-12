/*  ---------------------------------------------------------------------------
 *  Genetic Algorithm
 *  ------------------------------------
 *  The goal of this GA is to learn which creep to spawn (or to wait)
 *  under eight possible “world-states”.  A state is expressed as a
 *  3-bit string:
 *
 *      bit 0 (LSB) – room controller level ≥ 2 ?
 *      bit 1       – enough upgrader creeps ?
 *      bit 2 (MSB) – enough harvester creeps ?
 *
 *  Example: "101" means “enough harvesters (1), not enough upgraders (0),
 *  controller level ≥ 2 (1)”.
 *
 *  Each individual (chromosome) is therefore a lookup table:
 *      { "000": "WAIT", "001": "SPAWN_HARVESTER", … }
 *
 *  After EVAL_TICKS game ticks we assign a fitness, move to the next
 *  individual, and once the population is exhausted we breed a new
 *  generation by tournament selection -> crossover -> mutation.
 *  ------------------------------------------------------------------------ */

const STATES = ["000", "001", "010", "011", "100", "101", "110", "111"];
const ACTIONS = ["SPAWN_HARVESTER", "SPAWN_UPGRADER", "WAIT"];

const POP_SIZE = 6;
const EVAL_TICKS = 6000;
const SEG_GEN = 2;

// GA functions
function randomIndividual() {
  const ind = {};
  for (const s of STATES)
    ind[s] = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
  return ind;
}

function crossover(a, b, pc = 0.7) {
  const c = {};
  for (const s of STATES) c[s] = Math.random() < pc ? a[s] : b[s];
  return c;
}
function mutate(ind, pm = 0.01) {
  for (const s of STATES)
    if (Math.random() < pm)
      ind[s] = ACTIONS[Math.floor(Math.random() * ACTIONS.length)];
}

// Persist Memory to segment
function keepSegActive() {
  RawMemory.setActiveSegments([SEG_GEN]);
}

module.exports.load = function () {
  const seg = RawMemory.segments[SEG_GEN];

  if (seg === undefined) {
    if (!Memory.population) this.reset();
    keepSegActive();
    return;
  }
  if (typeof seg !== "string" || seg.length === 0 || seg === "undefined") {
    this.reset();
    keepSegActive();
    return;
  }
  try {
    Object.assign(Memory, JSON.parse(seg));
  } catch (e) {
    this.reset();
  }

  keepSegActive();
};

module.exports.save = function () {
  try {
    RawMemory.segments[SEG_GEN] = JSON.stringify({
      population: Memory.population,
      fitnesses: Memory.fitnesses,
      genIndex: Memory.genIndex,
      epochCount: Memory.epochCount,
      paused: Memory.paused,
      prevLevel: Memory.prevLevel,
    });
  } catch (e) {
    RawMemory.segments[SEG_GEN] = "{}";
  }
  keepSegActive();
};

// Population & fitness
module.exports.reset = function () {
  const base = {
    "000": "WAIT",
    "001": "WAIT",
    "010": "WAIT",
    "011": "WAIT",
    100: "SPAWN_HARVESTER",
    101: "WAIT",
    110: "SPAWN_UPGRADER",
    111: "WAIT",
  };
  Memory.population = [
    base,
    ...Array.from({ length: POP_SIZE - 1 }, randomIndividual),
  ];
  Memory.fitnesses = Array(POP_SIZE).fill(0);
  Memory.genIndex = 0;
  Memory.epochCount = 0;
  Memory.paused = false;
  Memory.prevLevel = 1;
};

module.exports.act = function (state) {
  if (!Memory.population || !Memory.population[Memory.genIndex]) this.reset();
  return Memory.population[Memory.genIndex][state];
};

module.exports.finishEvaluation = function (room) {
  const hist = Memory.evalHistory || [];
  let fit = hist.reduce((s, e) => s + (e.controllerProgressDelta || 0), 0);
  if (room.controller.level >= 2) fit += 50;

  Memory.fitnesses[Memory.genIndex] = fit;
  Memory.genIndex++;
  Memory.evalHistory = [];
  Memory.startTick = Game.time;

  // New gen
  if (Memory.genIndex >= POP_SIZE) {
    const order = _.range(POP_SIZE).sort(
      (a, b) => Memory.fitnesses[b] - Memory.fitnesses[a]
    );
    const newPop = [Memory.population[order[0]], Memory.population[order[1]]];
    while (newPop.length < POP_SIZE) {
      const top = order.slice(0, 5);
      const i = top[Math.floor(Math.random() * top.length)];
      let j;
      do {
        j = top[Math.floor(Math.random() * top.length)];
      } while (j === i);
      const child = crossover(Memory.population[i], Memory.population[j]);
      mutate(child);
      newPop.push(child);
    }
    Memory.population = newPop;
    Memory.fitnesses = Array(POP_SIZE).fill(0);
    Memory.genIndex = 0;
    Memory.epochCount++;
    console.log(`[GA] Generation ${Memory.epochCount} ready`);
  }

  Memory.paused = true;
  this.save();
  return fit;
};

module.exports.EVAL_TICKS = EVAL_TICKS;
