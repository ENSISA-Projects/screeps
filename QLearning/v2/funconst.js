module.exports = {
  generateExactBodyCombos: function (parts, maxParts) {
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
  },

  roomExistsAfterReset() {
    const myRooms = Object.values(Game.rooms).filter(
      (r) => r.controller && r.controller.my
    );
    if (!myRooms.length) return false;
    const r = myRooms[0];
    return r.controller.level === 1 && _.isEmpty(Game.creeps);
  },
};
