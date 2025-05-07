const roleManager = require('role.manager');

module.exports.loop = function () {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    console.log(`Room ${roomName}: ${room.energyAvailable}/${room.energyCapacityAvailable} energy`);
  }

  roleManager.loop();
};

