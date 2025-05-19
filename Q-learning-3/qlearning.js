// qlearning-episodic.js
// Q-learning avec apprentissage par épisodes

// Paramètres
const DEFAULT_CONFIG = {
  alpha: 0.2,      // Taux d'apprentissage
  gamma: 0.9,      // Facteur d'actualisation
  epsilon: 0.5,    // Probabilité d'exploration
  episodeLength: 100, // Nombre d'actions par épisode
  minEpsilon: 0.05,  // Limite basse d'exploration
  epsilonDecay: 0.9995, // Taux de décroissance d'epsilon
  rewardMemory: 100   // Nombre de récompenses à conserver pour analyse
};

// Fonction de clé pour la Q-table
const key = (s, action) => {
  if (action.type === 'WAIT') return `${s}|WAIT`;
  // pour un spawn : on concatène rôle + body
  return `${s}|SPAWN_${action.role}_${action.body.join('-')}`;
};

// Initialisation du cerveau si nécessaire
if (!Memory.brain) {
  Memory.brain = { 
    q: {}, 
    ...DEFAULT_CONFIG,
    episode: {
      actions: [],
      states: [],
      rewards: [],
      currentStep: 0
    },
    stats: {
      episodes: 0,
      totalReward: 0,
      recentRewards: [],
      avgReward: 0
    }
  };
}

module.exports = {
  // Réinitialiser l'épisode en cours
  resetEpisode() {
    Memory.brain.episode = {
      actions: [],
      states: [],
      rewards: [],
      currentStep: 0
    };
  },

  // Choisir une action selon la politique ε-greedy
  act(state, actions) {
    const B = Memory.brain;
    
    // Exploration
    if (Math.random() < B.epsilon) {
      return _.sample(actions);
    }
    
    // Exploitation: sélectionner la meilleure action
    let best = actions[0], bestQ = -Infinity;
    for (const a of actions) {
      const q = (B.q[key(state, a)] !== undefined) ? B.q[key(state, a)] : 0;
      if (q > bestQ) { bestQ = q; best = a; }
    }
    
    // Enregistrer l'état actuel dans l'épisode
    B.episode.states[B.episode.currentStep] = state;
    
    return best;
  },

  // Enregistrer action et récompense pour l'étape actuelle
  recordStep(action, reward) {
    const B = Memory.brain;
    B.episode.actions[B.episode.currentStep] = action;
    B.episode.rewards[B.episode.currentStep] = reward;
    B.episode.currentStep++;
    
    // Mettre à jour les statistiques
    B.stats.totalReward += reward;
    B.stats.recentRewards.push(reward);
    if (B.stats.recentRewards.length > B.rewardMemory) {
      B.stats.recentRewards.shift();
    }
    B.stats.avgReward = B.stats.recentRewards.reduce((sum, r) => sum + r, 0) / B.stats.recentRewards.length;

    return B.episode.currentStep >= B.episodeLength;
  },

  // Apprendre à partir de l'épisode complet
  learnEpisode(finalState, actions) {
    const B = Memory.brain;
    
    // Apprentissage de l'épisode
    for (let i = B.episode.currentStep - 1; i >= 0; i--) {
      const s = B.episode.states[i];
      const a = B.episode.actions[i];
      const r = B.episode.rewards[i];
      
      // État suivant est soit l'état suivant dans l'épisode, soit l'état final
      const s2 = (i === B.episode.currentStep - 1) ? finalState : B.episode.states[i + 1];
      
      // Q-learning standard
      const qs = (B.q[key(s, a)] !== undefined) ? B.q[key(s, a)] : 0;
      const qsp = _.max(actions.map(x => {
        return (B.q[key(s2, x)] !== undefined) ? B.q[key(s2, x)] : 0;
      }));
      
      // Mise à jour de la Q-valeur
      B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);
    }
    
    // Mettre à jour epsilon (décroissance)
    B.epsilon = Math.max(B.minEpsilon, B.epsilon * B.epsilonDecay);
    
    // Incrémenter le compteur d'épisodes
    B.stats.episodes++;
    
    // Réinitialiser pour le prochain épisode
    this.resetEpisode();
    
    return {
      episodeCount: B.stats.episodes,
      avgReward: B.stats.avgReward,
      qSize: Object.keys(B.q).length,
      epsilon: B.epsilon
    };
  },

  // Apprentissage direct (pour compatibilité)
  learn(s, a, r, s2, actions) {
    const B = Memory.brain;
    const qs = (B.q[key(s, a)] !== undefined) ? B.q[key(s, a)] : 0;
    const qsp = _.max(actions.map(x => {
      return (B.q[key(s2, x)] !== undefined) ? B.q[key(s2, x)] : 0;
    }));
    B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);

    B.epsilon = Math.max(B.minEpsilon, B.epsilon * B.epsilonDecay);
  },
  
  // Obtenir les statistiques actuelles
  getStats() {
    const B = Memory.brain;
    return {
      episodes: B.stats.episodes,
      avgReward: B.stats.avgReward,
      qSize: Object.keys(B.q).length,
      epsilon: B.epsilon,
      episodeStep: B.episode.currentStep,
      episodeLength: B.episodeLength
    };
  },
  
  // Modifier les paramètres
  setConfig(config) {
    const B = Memory.brain;
    Object.assign(B, { ...config });
    console.log(`[QLEARN] Configuration mise à jour: α=${B.alpha}, γ=${B.gamma}, ε=${B.epsilon}, episodeLength=${B.episodeLength}`);
  }
};