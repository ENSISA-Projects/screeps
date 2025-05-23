// qlearning-improved.js
const DEFAULT_CONFIG = {
  alpha: 0.2,
  gamma: 0.9,
  epsilon: 0.3,
  minEpsilon: 0.05,
  epsilonDecay: 0.995,
  episodeLength: 100,
  warmupEpisodes: 4
};

const key = (s, a) => `${s}|${a.type}|${a.role || ''}|${a.body ? a.body.join('-') : ''}`;

if (!Memory.brain) {
  Memory.brain = {
    q: {},
    ...DEFAULT_CONFIG,
    stats: {
      episodes: 0,
      recentRewards: [],
      avgReward: 0
    },
    currentEpisode: {
      steps: [],
      totalReward: 0
    }
  };
}

module.exports = {
  resetEpisode() {
    Memory.brain.currentEpisode = {
      steps: [],
      totalReward: 0
    };
  },

  act(state, actions) {
    const B = Memory.brain;
    
    if (Math.random() < B.epsilon) {
      return _.sample(actions);
    }
    
    let bestAction = actions[0];
    let bestQ = -Infinity;
    
    for (const a of actions) {
      const q = B.q[key(state, a)] || 0;
      if (q > bestQ) {
        bestQ = q;
        bestAction = a;
      }
    }
    
    return bestAction;
  },

  recordStep(state, action, reward) {
    const B = Memory.brain;
    
    if (!B.currentEpisode) this.resetEpisode();
    
    B.currentEpisode.steps.push({ state, action, reward });
    B.currentEpisode.totalReward += reward;
    
    return B.currentEpisode.steps.length >= B.episodeLength;
  },

  learnEpisode(finalState) {
    const B = Memory.brain;
    const episode = B.currentEpisode.steps;
    
    let G = 0;
    const returns = [];
    
    for (let t = episode.length - 1; t >= 0; t--) {
      G = B.gamma * G + episode[t].reward;
      returns.unshift(G);
    }
    
    for (let t = 0; t < episode.length; t++) {
      const { state, action } = episode[t];
      const k = key(state, action);
      const oldQ = B.q[k] || 0;
      B.q[k] = oldQ + B.alpha * (returns[t] - oldQ);
    }
    
    B.stats.episodes++;
    B.stats.recentRewards.push(B.currentEpisode.totalReward);
    if (B.stats.recentRewards.length > 20) B.stats.recentRewards.shift();
    B.stats.avgReward = _.sum(B.stats.recentRewards) / B.stats.recentRewards.length;
    
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

  getStats() {
    const B = Memory.brain;
    return {
      episodes: B.stats.episodes,
      avgReward: B.stats.avgReward,
      epsilon: B.epsilon,
      qSize: Object.keys(B.q).length
    };
  },
  learn(s, a, r, s2, actions) {
    const B   = Memory.brain;
    const qs  = (B.q[key(s, a)] !== undefined) ? B.q[key(s, a)] : 0;
    const qsp = _.max(actions.map(x => {
      const v = (B.q[key(s2, x)] !== undefined) ? B.q[key(s2, x)] : 0;
      return v;
    }));
    B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);

    B.epsilon = Math.max(0.05, B.epsilon * 0.9995);
  }
};