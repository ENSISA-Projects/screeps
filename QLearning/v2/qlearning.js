/******************************************************************************
 *  qlearning.js improved
 *  ----------------------------------------
 *  Tabular Q-learning helper with **episode-based Monte-Carlo updates** and the
 *  ability to **freeze learning** (evaluation mode).  
 *
 *  • `setFrozen(true)`  → exploration ε = 0, Q-table read-only, stats only.  
 *  • `act()`            → ε-greedy (or greedy if frozen).  
 *  • `recordStep()`     → log (s,a,r) into the current episode buffer.  
 *  • `learnEpisode()`   → Monte-Carlo return computation + Q-update.  
 *  • `learn()`          → classic one-step Q-learning (kept for convenience).  
 ******************************************************************************/

const DEFAULT_CONFIG = {
  alpha:          0.2,
  gamma:          0.9,
  epsilon:        0.3,
  minEpsilon:     0.05,
  epsilonDecay:   0.995,
  episodeLength:  100,
  warmupEpisodes: 4,
  frozen:         false
};

// Key Q-table : state | action type | role | body
const key = (s, a) =>
  `${s}|${a.type}|${a.role || ""}|${a.body ? a.body.join("-") : ""}`;

// Init of Memory.brain
if (!Memory.brain) {
  Memory.brain = {
    q: {},
    ...DEFAULT_CONFIG,
    stats: { episodes: 0, recentRewards: [], avgReward: 0 },
    currentEpisode: { steps: [], totalReward: 0 }
  };
}

// Helper
function isFrozen() { return !!Memory.brain.frozen; }

module.exports = {

  // Enable/Disable freezing
  setFrozen(flag = true) { Memory.brain.frozen = !!flag; },

  // Action selection (ε-greedy or greedy if frozen)
  act(state, actions) {
    const B       = Memory.brain;
    const explore = isFrozen() ? 0 : B.epsilon;   // ε = 0 if frozen

    if (Math.random() < explore) return _.sample(actions);

    // Greedy policy: return action with highest Q
    let bestAction = actions[0];
    let bestQ      = -Infinity;

    for (const a of actions) {
      const q = B.q[key(state, a)] || 0;
      if (q > bestQ) { bestQ = q; bestAction = a; }
    }
    return bestAction;
  },

  // Record a step in the current episode
  recordStep(state, action, reward) {
    const B = Memory.brain;
    if (!B.currentEpisode) this.resetEpisode();

    B.currentEpisode.steps.push({ state, action, reward });
    B.currentEpisode.totalReward += reward;

    return B.currentEpisode.steps.length >= B.episodeLength;
  },

  // Monte-Carlo learning on the complete episode
  learnEpisode(finalState) {
    if (isFrozen()) return this.getStats();   // no learning

    const B       = Memory.brain;
    const episode = B.currentEpisode.steps;

    // Calculate returns (G) by traversing the timeline
    let G = 0;
    const returns = [];
    for (let t = episode.length - 1; t >= 0; t--) {
      G = B.gamma * G + episode[t].reward;
      returns.unshift(G);
    }

    // Update the Q-table
    for (let t = 0; t < episode.length; t++) {
      const { state, action } = episode[t];
      const k    = key(state, action);
      const oldQ = B.q[k] || 0;
      B.q[k]     = oldQ + B.alpha * (returns[t] - oldQ);
    }

    // Global stats
    B.stats.episodes++;
    B.stats.recentRewards.push(B.currentEpisode.totalReward);
    if (B.stats.recentRewards.length > 20) B.stats.recentRewards.shift();
    B.stats.avgReward = _.sum(B.stats.recentRewards) / B.stats.recentRewards.length;

    // Epsilon decay after warmup period
    if (B.stats.episodes > B.warmupEpisodes) {
      B.epsilon = Math.max(B.minEpsilon, B.epsilon * B.epsilonDecay);
    }

    this.resetEpisode();
    return {
      episode: B.stats.episodes,
      avgReward: B.stats.avgReward,
      epsilon: B.epsilon,
      qSize: Object.keys(B.q).length
    };
  },

  // Q-Learning one-step
  learn(s, a, r, s2, actions) {
    if (isFrozen()) return;    // no learning

    const B   = Memory.brain;
    const qs  = B.q[key(s, a)] || 0;
    const qsp = _.max(actions.map(x => B.q[key(s2, x)] || 0));

    B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);
    B.epsilon = Math.max(0.05, B.epsilon * 0.9995);   // slight ε decay
  },

  // Reset the current episode
  resetEpisode() {
    Memory.brain.currentEpisode = { steps: [], totalReward: 0 };
  },

  // Quick stats consultation
  getStats() {
    const B = Memory.brain;
    return {
      episodes: B.stats.episodes,
      avgReward: B.stats.avgReward,
      epsilon: B.epsilon,
      qSize: Object.keys(B.q).length
    };
  }
};
