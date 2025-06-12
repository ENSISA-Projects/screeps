/******************************************************************************
 *  qlearning_builder.js — episodic Q-learning brain for “builder” creeps
 *  ---------------------------------------------------------------------
 *  • Each builder uses a *global* Q-table stored in `Memory.builderBrain.q`.
 *  • Actions can be complex objects (target IDs, body shapes …), so we hash
 *    them with `JSON.stringify` and use that hash as the key.
 *  • The agent collects a short trajectory (≤ 10 steps) and, at the end of the
 *    episode, walks it **backwards** to apply TD(0):
 *
 *        Q(s,a) ← Q(s,a) + α · ( r + γ · maxₐ′Q(s′,a′) − Q(s,a) )
 *
 *  • Exploration ε decays exponentially from 1.0 → 0.05.
 *  • A *frozen* flag lets you disable learning and force greedy play.
 ******************************************************************************/

const EPSILON_START = 1.0;
const EPSILON_END = 0.05;
const EPSILON_DECAY = 0.001;
const GAMMA = 0.9;
const ALPHA = 0.1;
const MAX_EPISODES = 10000;

function hash(action) {
  return JSON.stringify(action);
}

function argmax(dict) {
  let maxKey = null;
  let maxVal = -Infinity;
  for (const [k, v] of Object.entries(dict)) {
    if (v > maxVal) {
      maxVal = v;
      maxKey = k;
    }
  }
  return maxKey;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

if (!Memory.builderBrain) {
  Memory.builderBrain = {
    q: {},
    episode: 0,
    epsilon: EPSILON_START,
    stats: {
      avgReward: 0,
      episodes: 0,
    },
  };
}

let frozen = false;
let currentTrajectory = [];

module.exports = {
  setFrozen(flag) {
    frozen = flag;
  },

  resetEpisode() {
    currentTrajectory = [];
  },

  act(state, actions) {
    const q = Memory.builderBrain.q;
    const epsilon = Memory.builderBrain.epsilon;

    if (!q[state]) q[state] = {};
    for (const a of actions) {
      const key = hash(a);
      if (!(key in q[state])) q[state][key] = 0;
    }

    if (frozen || Math.random() > epsilon) {
      const best = argmax(q[state]);
      return JSON.parse(best);
    } else {
      return actions[Math.floor(Math.random() * actions.length)];
    }
  },

  recordStep(state, action, reward) {
    currentTrajectory.push({ state, action, reward });
    return currentTrajectory.length > 10;
  },

  learnEpisode(nextState) {
    const q = Memory.builderBrain.q;

    for (let t = currentTrajectory.length - 1; t >= 0; t--) {
      const { state, action, reward } = currentTrajectory[t];
      const key = hash(action);

      if (!q[state]) q[state] = {};
      if (!(key in q[state])) q[state][key] = 0;

      let maxQNext = 0;
      if (q[nextState]) {
        maxQNext = Math.max(...Object.values(q[nextState]));
      }

      q[state][key] += ALPHA * (reward + GAMMA * maxQNext - q[state][key]);
    }

    const totalReward = currentTrajectory.reduce(
      (sum, step) => sum + step.reward,
      0
    );
    currentTrajectory = [];

    const brain = Memory.builderBrain;
    brain.episode++;
    brain.stats.episodes++;
    brain.stats.avgReward = brain.stats.avgReward * 0.9 + totalReward * 0.1;
    brain.epsilon = Math.max(
      EPSILON_END,
      brain.epsilon * Math.exp(-EPSILON_DECAY * brain.episode)
    );

    return {
      episode: brain.episode,
      avgReward: brain.stats.avgReward,
      epsilon: brain.epsilon,
    };
  },

  learn(state, action, reward, nextState, actions) {
    const q = Memory.builderBrain.q;
    const key = hash(action);
    if (!q[state]) q[state] = {};
    if (!(key in q[state])) q[state][key] = 0;

    let maxQNext = 0;
    if (q[nextState]) {
      for (const a of actions) {
        const nextKey = hash(a);
        if (!(nextKey in q[nextState])) q[nextState][nextKey] = 0;
        maxQNext = Math.max(maxQNext, q[nextState][nextKey]);
      }
    }

    q[state][key] += ALPHA * (reward + GAMMA * maxQNext - q[state][key]);
  },
};
