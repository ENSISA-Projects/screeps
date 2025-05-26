from __future__ import annotations
import subprocess
import sys
import time
from typing import List, Dict, Tuple, Any

import gymnasium as gym
from gymnasium import spaces
import numpy as np
from screepsapi import API

# ──────────────────────────────────────────────
#  ACTION & STATE HELPERS
# ──────────────────────────────────────────────
PARTS = ["WORK", "CARRY", "MOVE"]
ROLES = ["harvester", "upgrader"]


def generate_exact_body_combos(parts: List[str], max_parts: int) -> List[List[str]]:
    combos: List[List[str]] = []

    def helper(prefix: List[str], depth: int):
        if depth == max_parts:
            combos.append(prefix.copy())
            return
        for p in parts:
            prefix.append(p)
            helper(prefix, depth + 1)
            prefix.pop()

    helper([], 0)
    return combos


ALL_BODIES = generate_exact_body_combos(PARTS, 3)

# Liste des actions exactement comme dans le code JS
ACTIONS: List[Dict[str, Any]] = [
    {"type": "SPAWN", "role": role, "body": body}
    for body in ALL_BODIES
    for role in ROLES
]
ACTIONS.append({"type": "WAIT"})  # index final


# ──────────────────────────────────────────────
#  ENVIRONNEMENT DQN ALIGNÉ SUR Q‑LEARNING JS
# ──────────────────────────────────────────────
class ScreepsSpawnEnv(gym.Env):
    """Agent de niveau salle qui choisit de "SPAWN" ou "WAIT".

    Observation (5 dim) = [energyFlag, harvesterWork, upgraderWork, ctrlLvl, ctrlProg/100]
    Action             = Discret(len(ACTIONS))
    """

    metadata = {"render_modes": ["human"]}

    def __init__(
        self,
        user: str,
        password: str,
        host: str,
        secure: bool,
        shard: str,
        render_mode: str | None = None,
    ):
        super().__init__()
        self.api = API(u=user, p=password, host=host, secure=secure)
        self.shard = shard
        self.render_mode = render_mode

        # --- espace des actions/states ---
        self.action_space = spaces.Discrete(len(ACTIONS))
        low = np.array([0, 0, 0, 1, 0], dtype=np.float32)  # min bounds
        high = np.array([1, 50, 50, 8, 500], dtype=np.float32)  # RCL8 et prog simplifié
        self.observation_space = spaces.Box(low, high, dtype=np.float32)

        # vars internes
        self._prev_state: np.ndarray | None = None

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        # ① on lance ton script externe
        subprocess.run([sys.executable, "reset.py"], check=True)
        #     - sys.executable = le Python en cours
        #     - check=True ⇒ exception si le script plante

        # ② (facultatif) laisser 2–3 s / ticks au serveur pour appliquer
        self._wait_tick(3)

        # ③ état initial
        self._inject_state_snippet()
        self._wait_tick()
        obs = self._get_obs()
        self._prev_state = obs.copy()
        return obs, {}

    def step(
        self,
        action: int,
    ) -> Tuple[np.ndarray, float, bool, bool, Dict]:
        act_obj = ACTIONS[action]

        # Exécuter l'action via console JS
        if act_obj["type"] == "SPAWN":
            role = act_obj["role"]
            body = act_obj["body"]
            parts = ",".join(body)
            js = f"""
                    const room = Object.values(Game.rooms).find(r => r.controller && r.controller.my);
                    if (room) {{
                    const spawn = _.find(Game.spawns, s => !s.spawning);
                    if (spawn && room.energyAvailable >= 200) {{
                        spawn.spawnCreep(
                        [{parts}],
                        `{role[0].upper()}_${{Game.time}}`,
                        {{ memory: {{ role: '{role}' }} }}
                        );
                    }}
                    }}
                """

            self._console(js)
        # WAIT → pas d'action

        # Mettre l'état JS à jour + attendre un tick
        self._inject_state_snippet()
        self._wait_tick()

        obs = self._get_obs()
        reward = self._compute_reward(self._prev_state, obs, act_obj)
        self._prev_state = obs.copy()

        terminated = bool(obs[3] >= 2)  # RCL2 atteint → fin d'épisode
        truncated = False
        info: Dict[str, Any] = {}
        return obs, reward, terminated, truncated, info

    # ── Rendu simple ───────────────────────
    def render(self) -> None:  # affichage console facultatif
        if self.render_mode != "human":
            return
        s = self._get_obs()
        print(
            f"E:{int(s[0])} | H:{int(s[1])} | U:{int(s[2])} | RCL:{int(s[3])} | prog:{int(s[4])}"
        )

    # ── Helpers JS/API ──────────────────────
    def _console(self, code: str) -> None:
        self.api.console(code, shard=self.shard)

    def _wait_tick(self, n: float = 1):
        time.sleep(0.1 * n)

    def _inject_state_snippet(self):
        """Injecte du JS qui calcule l'état et le place dans Memory.dqn_state."""
        js = (
            "const room=Object.values(Game.rooms).find(r=>r.controller && r.controller.my);"
            "if(room){"
            "const e=room.energyAvailable>=200?1:0;"
            "const h=_.sum(_.filter(Game.creeps,c=>c.memory.role==='harvester').map(c=>c.getActiveBodyparts(WORK)));"
            "const u=_.sum(_.filter(Game.creeps,c=>c.memory.role==='upgrader').map(c=>c.getActiveBodyparts(WORK)));"
            "const cl=room.controller.level;"
            "const cp=Math.floor(room.controller.progress/100);"
            "Memory.dqn_state=[e,h,u,cl,cp];}"
        )
        self._console(js)

    def _get_obs(self) -> np.ndarray:
        mem = self.api.memory("", shard=self.shard).get("dqn_state", [0, 0, 0, 1, 0])
        return np.array(mem, dtype=np.float32)

    def _compute_reward(
        self, prev: np.ndarray, curr: np.ndarray, action_obj: Dict[str, Any]
    ) -> float:
        # Base penalty
        r = -0.1

        # Pénalité spawn sans MOVE
        if action_obj["type"] == "SPAWN" and "MOVE" not in action_obj["body"]:
            r -= 1.0

        # Avancement contrôleur
        progress_delta = curr[4] - prev[4]
        if progress_delta > 0:
            r += float(progress_delta)

        # Équilibre harvesters / upgraders via work parts comme proxy
        h, u = curr[1], curr[2]
        total = h + u
        if total > 0:
            ratio = h / total
            r -= (abs(ratio - 0.6) ** 2) * 5.0

        # Bonus RCL2 atteint
        if curr[3] >= 2:
            r += 20.0

        return r
