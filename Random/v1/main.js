/******************************************************************************
 *  main.js — top-level loop
 *  -------------------------------
 *  Responsibilities:
 *    1.  Print the current energy stats for every visible room.
 *    2.  Delegate all colony logic to the role-based manager (`role.manager`).
 ******************************************************************************/
const roleManager = require("role.manager");

module.exports.loop = function () {
  // Iterate over each room we control
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    console.log(
      `Room ${roomName}: ${room.energyAvailable}/${room.energyCapacityAvailable} energy`
    );
  }
  // Delegate all colony logic
  roleManager.loop();
};
