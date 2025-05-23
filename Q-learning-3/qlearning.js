// -----------------------------------------------------------------------------
// qlearning-improved.js — v2 (23 mai 2025)
// Ajout de la possibilité de geler l’apprentissage (mode évaluation)
// -----------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  alpha:          0.2,
  gamma:          0.9,
  epsilon:        0.3,
  minEpsilon:     0.05,
  epsilonDecay:   0.995,
  episodeLength:  100,
  warmupEpisodes: 4,
  frozen:         false               // ← flag interne (true = gelé)
};

// Clef Q-table : état | type d’action | rôle | corps
const key = (s, a) =>
  `${s}|${a.type}|${a.role || ""}|${a.body ? a.body.join("-") : ""}`;

// -----------------------------------------------------------------------------
// Initialisation de Memory.brain (si nécessaire)
// -----------------------------------------------------------------------------
if (!Memory.brain) {
  Memory.brain = {
    q: {},
    ...DEFAULT_CONFIG,
    stats: { episodes: 0, recentRewards: [], avgReward: 0 },
    currentEpisode: { steps: [], totalReward: 0 }
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function isFrozen() { return !!Memory.brain.frozen; }

// -----------------------------------------------------------------------------
// Module exporté
// -----------------------------------------------------------------------------
module.exports = {

  // ---------------------------------------------------------------------------
  // Permet au code principal d’activer/désactiver le gel
  // ---------------------------------------------------------------------------
  setFrozen(flag = true) { Memory.brain.frozen = !!flag; },

  // ---------------------------------------------------------------------------
  // Choix d’action (ε-greedy ou greedy si gelé)
  // ---------------------------------------------------------------------------
  act(state, actions) {
    const B       = Memory.brain;
    const explore = isFrozen() ? 0 : B.epsilon;   // ε = 0 si gelé

    if (Math.random() < explore) return _.sample(actions);

    // Politique greedy : on renvoie l’action avec le meilleur Q
    let bestAction = actions[0];
    let bestQ      = -Infinity;

    for (const a of actions) {
      const q = B.q[key(state, a)] || 0;
      if (q > bestQ) { bestQ = q; bestAction = a; }
    }
    return bestAction;
  },

  // ---------------------------------------------------------------------------
  // Enregistrement d’un pas dans l’épisode courant
  // ---------------------------------------------------------------------------
  recordStep(state, action, reward) {
    const B = Memory.brain;
    if (!B.currentEpisode) this.resetEpisode();

    B.currentEpisode.steps.push({ state, action, reward });
    B.currentEpisode.totalReward += reward;

    return B.currentEpisode.steps.length >= B.episodeLength;
  },

  // ---------------------------------------------------------------------------
  // Apprentissage Monte-Carlo sur l’épisode complet
  // ─ (retourne juste les stats si gelé, sans toucher à la Q-table)
  // ---------------------------------------------------------------------------
  learnEpisode(finalState) {
    if (isFrozen()) return this.getStats();   // aucun apprentissage

    const B       = Memory.brain;
    const episode = B.currentEpisode.steps;

    // Calcul des retours (G) en remontant la timeline
    let G = 0;
    const returns = [];
    for (let t = episode.length - 1; t >= 0; t--) {
      G = B.gamma * G + episode[t].reward;
      returns.unshift(G);
    }

    // Mise à jour de la Q-table
    for (let t = 0; t < episode.length; t++) {
      const { state, action } = episode[t];
      const k    = key(state, action);
      const oldQ = B.q[k] || 0;
      B.q[k]     = oldQ + B.alpha * (returns[t] - oldQ);
    }

    // Stats globales
    B.stats.episodes++;
    B.stats.recentRewards.push(B.currentEpisode.totalReward);
    if (B.stats.recentRewards.length > 20) B.stats.recentRewards.shift();
    B.stats.avgReward = _.sum(B.stats.recentRewards) / B.stats.recentRewards.length;

    // Décroissance d’ε après la période de chauffe
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

  // ---------------------------------------------------------------------------
  // Q-Learning one-step — ignoré si gelé
  // ---------------------------------------------------------------------------
  learn(s, a, r, s2, actions) {
    if (isFrozen()) return;    // pas d’apprentissage

    const B   = Memory.brain;
    const qs  = B.q[key(s, a)] || 0;
    const qsp = _.max(actions.map(x => B.q[key(s2, x)] || 0));

    B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);
    B.epsilon = Math.max(0.05, B.epsilon * 0.9995);   // ε decay léger
  },

  // ---------------------------------------------------------------------------
  // Reset de l’épisode en cours
  // ---------------------------------------------------------------------------
  resetEpisode() {
    Memory.brain.currentEpisode = { steps: [], totalReward: 0 };
  },

  // ---------------------------------------------------------------------------
  // Consultation rapide des stats
  // ---------------------------------------------------------------------------
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
