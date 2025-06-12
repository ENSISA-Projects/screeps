/******************************************************************************
 *  creep.brain.js — ε-greedy tabular Q-learning helpers
 *  ---------------------------------------------------
 *  Two tiny utilities exported for per-agent brains:
 *
 *     • act()   – ε-greedy action selection
 *     • learn() – one-step Q-update   Q(s,a) ← (1-α)·Q + α·[ r + γ·maxₐ′ Q(s′,a′) ]
 *
 *  The calling “brain” object is expected to hold:
 *     {
 *       q      : { "state|action": Number, ... },   // Q-table
 *       alpha  : Number,    // learning-rate   (typ. 0.1–0.3)
 *       gamma  : Number,    // discount factor (typ. 0.8–0.95)
 *       epsilon: Number     // exploration rate (decays in learn())
 *     }
 ******************************************************************************/

const _ = require("lodash");

function safeQ(q, key) {
  return q[key] !== undefined ? q[key] : 0;
}

function key(state, action) {
  return `${state}|${action}`;
}

module.exports = {
  act(state, actions, brain) {
    if (Math.random() < brain.epsilon) {
      return _.sample(actions);
    }
    let bestA = actions[0],
      bestQ = -Infinity;
    for (const a of actions) {
      const qv = safeQ(brain.q, key(state, a));
      if (qv > bestQ) {
        bestQ = qv;
        bestA = a;
      }
    }
    return bestA;
  },

  learn(s, a, r, s2, actions, brain) {
    const k = key(s, a);
    const qs = safeQ(brain.q, k);
    const qsp = _.max(actions.map((act) => safeQ(brain.q, key(s2, act))));
    brain.q[k] = (1 - brain.alpha) * qs + brain.alpha * (r + brain.gamma * qsp);

    brain.epsilon = Math.max(0.05, brain.epsilon * 0.9995);
  },
};
