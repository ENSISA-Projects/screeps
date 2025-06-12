/******************************************************************************
 *  qlearning.js - Q-learning “brain”
 *  -----------------------------------
 *  • Each (state, action) pair is stored in a table B.q under the key "state|action".
 *  • act()   –  ε-greedy policy: with probability ε pick a random action
 *               (exploration), otherwise pick the action with the highest Q value
 *               (exploitation).
 *  • learn() –  one-step Q-update after observing reward r and successor state s2:
 *                   Q(s,a) ← (1-α)·Q(s,a) + α·( r + γ·max_a' Q(s',a') )
 *               plus soft ε-decay toward 0.05.
 *
 *  Parameters stored in Memory.brain
 *      alpha   – learning rate
 *      gamma   – discount factor
 *      epsilon – exploration rate
 ******************************************************************************/

const key = (s, a) => `${s}|${a}`;

/* -------------------------------------------------------------------------
 *  Initialise persistent brain if it doesn’t exist yet.
 *    B.q       – Q-table  (object: { "state|action": value, … })
 *    B.alpha   – learning rate   (α)
 *    B.gamma   – discount factor (γ)
 *    B.epsilon – exploration rate (ε)
 * ---------------------------------------------------------------------- */
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

    // decay epsilon
    B.epsilon = Math.max(0.05, B.epsilon * 0.9995);
  },
};
