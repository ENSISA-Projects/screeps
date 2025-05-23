from screepsapi import API
import gym
from gym import spaces
import numpy as np
import time

class ScreepsEnv(gym.Env):
    metadata = {'render.modes': ['human']}

    def __init__(self,
                 user: str,
                 password: str,
                 host: str,
                 secure: bool,
                 shard: str,
                 spawn_name: str,
                 creep_name: str,
                 body_config=None):
        super().__init__()
        self.api = API(u=user, p=password, host=host, secure=secure)
        self.shard = shard
        self.spawn_name = spawn_name
        self.creep_name = creep_name
        # Liste des parties du creep, sous forme de chaînes WORK, CARRY, MOVE...
        self.body_config = body_config or ['WORK', 'CARRY', 'MOVE']

        self.action_space = spaces.Discrete(6)
        low = np.array([0, 0, 0], dtype=np.float32)
        high = np.array([49, 49, 100], dtype=np.float32)
        self.observation_space = spaces.Box(low=low, high=high, dtype=np.float32)

    def reset(self):
        # Construction de la liste JS des body parts sans guillemets
        body_js = ','.join(self.body_config)
        cmd = (
            f"Game.spawns['{self.spawn_name}']"
            f".spawnCreep([{body_js}], '{self.creep_name}', {{memory:{{role:'agent'}}}});"
        )
        print(cmd)
        self.api.console(cmd, shard=self.shard)

        # Attente que le creep soit effectivement créé
        for _ in range(50):
            room = self._discover_room()
            if room is None:
                time.sleep(0.1)
                continue
            ov = self.api.room_overview(room=room, shard=self.shard)
            if self.creep_name in ov.get('creeps', {}):
                break
            time.sleep(0.1)
        return self._get_obs()

    def step(self, action):
        dirs = {0: 'TOP', 1: 'RIGHT', 2: 'BOTTOM', 3: 'LEFT'}
        if action in dirs:
            cmd = (
                f"Game.creeps['{self.creep_name}']"
                f".move(Direction.{dirs[action]});"
            )
        elif action == 4:
            cmd = (
                f"Game.creeps['{self.creep_name}']"
                ".harvest(Game.getObjectById(sourceId));"
            )
        elif action == 5:
            cmd = (
                f"Game.creeps['{self.creep_name}']"
                ".build(Game.getObjectById(siteId));"
            )
        else:
            raise ValueError(f"Action inconnue : {action}")
        self.api.console(cmd, shard=self.shard)
        time.sleep(0.1)
        obs = self._get_obs()
        reward = obs[2]
        done = obs[2] >= 100
        return obs, reward, done, {}

    def render(self, mode='human'):
        room, x, y = self._discover_creep_position()
        energy = self._get_obs()[2]
        print(f"Creep '{self.creep_name}' in {room} at ({x},{y}), energy={energy:.0f}")

    def _get_obs(self):
        resp = self.api.memory(path='', shard=self.shard)
        mem = resp.get('data', resp)
        state = mem.get('state', {})
        return np.array([state.get('x', 0), state.get('y', 0), state.get('energy', 0)], dtype=np.float32)

    def _discover_room(self):
        me = self.api.me()
        rooms = self.api.user_rooms(me['_id'], shard=self.shard)
        if isinstance(rooms, dict) and 'shards' in rooms:
            room_list = rooms['shards'].get(self.shard, [])
        elif isinstance(rooms, list):
            room_list = rooms
        else:
            room_list = list(rooms.keys())
        return room_list[0] if room_list else None

    def _discover_creep_position(self):
        me = self.api.me()
        user_id = me['_id']
        room = self._discover_room()
        ov = self.api.room_overview(room=room, shard=self.shard)
        for cid, info in ov.get('creeps', {}).items():
            if info.get('user') == user_id and info.get('name') == self.creep_name:
                return room, info['x'], info['y']
        return room, 0, 0

if __name__ == "__main__":
    USER = "quen"
    PASSWORD = "1234"
    HOST = "51.210.254.22:21025"
    SECURE = False
    SHARD = "shard0"
    SPAWN_NAME = "Spawn1"
    CREEP_NAME = "MonCreep2"
    BODY = ['WORK', 'CARRY', 'MOVE']

    env = ScreepsEnv(
        user=USER,
        password=PASSWORD,
        host=HOST,
        secure=SECURE,
        shard=SHARD,
        spawn_name=SPAWN_NAME,
        creep_name=CREEP_NAME,
        body_config=BODY
    )

    obs = env.reset()
    print("Observation initiale :", obs)
    for step in range(20):
        action = env.action_space.sample()
        obs, reward, done, _ = env.step(action)
        print(f"Step {step:02d} → obs={obs}, reward={reward:.0f}, done={done}")
        env.render()
        if done:
            print("Fin de l'épisode.")
            break
