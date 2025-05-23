"""
DQN + Screeps
"""

from __future__ import annotations
import time
from typing import Sequence, Tuple, Dict, Any

import gymnasium as gym
from gymnasium import spaces
import numpy as np
from screepsapi import API
from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv


# ──────────────────────────────────────────────
#  ENVIRONNEMENT
# ──────────────────────────────────────────────
class ScreepsEnv(gym.Env):
    """Obs : (x, y, energy) – Actions : 0 ↑,1 →,2 ↓,3 ←,4 harvest,5 build."""

    metadata = {"render_modes": ["human"]}

    _DIRS = {0: 1, 1: 3, 2: 5, 3: 7}          # TOP=1 RIGHT=3 BOTTOM=5 LEFT=7

    # ── init ──────────────────────────────────
    def __init__(
        self,
        user: str,
        password: str,
        host: str,
        secure: bool,
        shard: str,
        spawn_name: str,
        creep_name: str,
        body_config: Sequence[str] | None = None,
        render_mode: str | None = None,
    ):
        super().__init__()

        self.api = API(u=user, p=password, host=host, secure=secure)
        self.shard, self.spawn_name, self.creep_name = shard, spawn_name, creep_name
        self.body_config = body_config or ["WORK", "CARRY", "MOVE"]
        self.render_mode = render_mode

        self.action_space = spaces.Discrete(6)
        low, high = np.array([0, 0, 0], np.float32), np.array([49, 49, 100], np.float32)
        self.observation_space = spaces.Box(low, high, dtype=np.float32)

    # ── gym API helpers ───────────────────────
    def reset(            # type: ignore[override]
        self,
        *,
        seed: int | None = None,
        options: Dict[str, Any] | None = None,
    ) -> Tuple[np.ndarray, Dict]:
        super().reset(seed=seed)

        # Spawn du creep (ignore déjà-existant)
        parts = ",".join(self.body_config)
        self._console(
            f"try{{Game.spawns['{self.spawn_name}']."
            f"spawnCreep([{parts}], '{self.creep_name}', {{memory:{{role:'agent'}}}})}}catch(e){{}}"
        )

        # attendre création effective (≤ 100 ticks)
        for _ in range(100):
            room = self._discover_room()
            if room and self.creep_name in self._room_overview(room).get("creeps", {}):
                break
            self._wait_tick()

        obs = self._get_obs()
        return obs, {}                       # ← tuple (obs, info)

    def step(              # type: ignore[override]
        self,
        action: int,
    ) -> Tuple[np.ndarray, float, bool, bool, Dict]:
        # JS à injecter selon l’action
        if action in self._DIRS:
            js = (
                f"const c=Game.creeps['{self.creep_name}'];"
                f"if(c) c.move({self._DIRS[action]});"
            )
        elif action == 4:  # harvest
            js = (
                f"const c=Game.creeps['{self.creep_name}'];"
                f"if(c){{const s=c.pos.findClosestByPath(FIND_SOURCES);if(s) c.harvest(s);}}"
            )
        elif action == 5:  # build
            js = (
                f"const c=Game.creeps['{self.creep_name}'];"
                f"if(c){{const site=c.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);"
                f"if(site) c.build(site);}}"
            )
        else:
            raise ValueError(f"Action inconnue : {action}")

        self._console(js)
        self._wait_tick()

        obs = self._get_obs()
        reward = float(obs[2])               # énergie stockée
        terminated = reward >= 100           # objectif rempli
        truncated = False                    # pas de coupure temps
        info: Dict[str, Any] = {}
        return obs, reward, terminated, truncated, info

    # ── Rendu simple ─────────────────────────
    def render(self) -> None:
        if self.render_mode != "human":
            return
        x, y, e = self._get_obs()
        print(f"{self.creep_name} → ({x:.0f},{y:.0f}) | energy={e:.0f}")

    # ── API bas niveau ───────────────────────
    def _console(self, code: str) -> None:
        self.api.console(code, shard=self.shard)

    def _wait_tick(self, n: float = 1) -> None:
        time.sleep(0.1 * n)                 # ajustez 0.1 s si votre tick < 100 ms

    def _discover_room(self) -> str | None:
        me = self.api.me()["_id"]
        rooms = self.api.user_rooms(me, shard=self.shard)
        if isinstance(rooms, dict) and "shards" in rooms:
            rooms = rooms["shards"].get(self.shard, [])
        elif isinstance(rooms, dict):
            rooms = list(rooms.keys())
        return rooms[0] if rooms else None

    def _room_overview(self, room: str) -> dict:
        return self.api.room_overview(room=room, shard=self.shard)

    def _get_obs(self) -> np.ndarray:
        mem = self.api.memory("", shard=self.shard).get("data", {})
        state = mem.get("state", {})
        return np.array(
            [state.get("x", 0), state.get("y", 0), state.get("energy", 0)],
            dtype=np.float32,
        )


# ──────────────────────────────────────────────
#  MAIN : DQN
# ──────────────────────────────────────────────
if __name__ == "__main__":
    # Paramètres serveur
    USER, PASSWORD = "quen", "1234"
    HOST, SECURE = "51.210.254.22:21025", False
    SHARD, SPAWN, CREEP = "shard0", "Spawn1", "MonCreep2"

    env = DummyVecEnv(
        [
            lambda: ScreepsEnv(
                user=USER,
                password=PASSWORD,
                host=HOST,
                secure=SECURE,
                shard=SHARD,
                spawn_name=SPAWN,
                creep_name=CREEP,
            )
        ]
    )

    model = DQN(
        "MlpPolicy",
        env,
        learning_rate=1e-4,
        buffer_size=10_000,
        learning_starts=1_000,
        batch_size=32,
        gamma=0.99,
        target_update_interval=500,
        train_freq=(1, "step"),
        tensorboard_log="./tb_screeps",
        verbose=1,
        device="cpu",                 # "cuda" si dispo
    )

    model.learn(total_timesteps=50_000)
    model.save("dqn_screeps")
    print("✓ Modèle sauvegardé → dqn_screeps.zip")
