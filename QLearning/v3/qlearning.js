/******************************************************************************
 *  qlearning.js — room-level Q-learning helper for SPAWN / WAIT decisions
 *  -----------------------------------------------------------------
 *  The action space handled by this brain is heterogeneous:
 *      • { type:"WAIT" }
 *      • { type:"SPAWN", role:"harvester"|"upgrader", body:[…] }
 *
 *  Therefore the Q-table key must encode **state + full action spec**.
 *  The table itself is persisted under `Memory.brain.q`.
 *
 *      Q-update rule  :  TD(0)   Q ← (1-α)·Q + α·( r + γ·maxₐ′ Q(s′,a′) )
 *      Exploration    :  ε-greedy, ε decays gently each learn() call.
 *****************************************************************************/

const key = (s, action) => {
  if (action.type === "WAIT") return `${s}|WAIT`;
  // pour un spawn : on concatène rôle + body
  return `${s}|SPAWN_${action.role}_${action.body.join("-")}`;
};

if (!Memory.brain) {
  Memory.brain = { q: {}, alpha: 0.2, gamma: 0.9, epsilon: 0.3 };
}

module.exports = {
  act(state, actions) {
    const B = Memory.brain;
    if (Math.random() < B.epsilon) return _.sample(actions); // exploration

    let best = actions[0],
      bestQ = -Infinity;
    for (const a of actions) {
      const q = B.q[key(state, a)] !== undefined ? B.q[key(state, a)] : 0;
      if (q > bestQ) {
        bestQ = q;
        best = a;
      }
    }
    return best;
  },

  learn(s, a, r, s2, actions) {
    const B = Memory.brain;
    const qs = B.q[key(s, a)] !== undefined ? B.q[key(s, a)] : 0;
    const qsp = _.max(
      actions.map((x) => {
        const v = B.q[key(s2, x)] !== undefined ? B.q[key(s2, x)] : 0;
        return v;
      })
    );
    B.q[key(s, a)] = (1 - B.alpha) * qs + B.alpha * (r + B.gamma * qsp);

    B.epsilon = Math.max(0.05, B.epsilon * 0.9995);
  },
};
