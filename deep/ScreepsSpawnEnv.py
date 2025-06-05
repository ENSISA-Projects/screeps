from __future__ import annotations
import subprocess
import sys
import time
from typing import List, Dict, Tuple, Any
import json
from collections.abc import Mapping


import gymnasium as gym
from gymnasium import spaces
import numpy as np
from screepsapi import API

# ──────────────────────────────────────────────
#  ACTION & STATE HELPERS
# ──────────────────────────────────────────────
PARTS = ["WORK", "CARRY", "MOVE"]
ROLES = ["harvester", "upgrader"]
DEBUG_RCL = True


# ── Helper global ───────────────────────────
def js_iife(body: str) -> str:
    """Emballe le code JS dans une IIFE silencieuse."""
    return f"(function(){{{body}}})();0"


# ── helpers ───────────────────────────────────────────────────────────
def _to_list(v):
    # --- déballer la valeur "data" si présent ---
    if isinstance(v, Mapping) and "data" in v:
        v = v["data"]  # ← idem ici

    # 1) décodage récursif des chaînes JSON
    while isinstance(v, str):
        try:
            v = json.loads(v)
        except json.JSONDecodeError:
            break

    # 2) si c’est encore un Mapping style tableau JS
    if isinstance(v, Mapping):
        try:
            v = [v[str(i)] for i in sorted(map(int, v.keys()))]
        except Exception:
            v = list(v.values())

    # 3) fallback sécurité
    if not isinstance(v, list) or len(v) != 5:
        v = [0, 0, 0, 1, 0]

    return v


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

        self._tick = 0  # avance d’un cran à chaque step
        self._first_spawn_tick = None  # tick où ≥1 creep est en jeu
        self._creeps_seen = 0  # total de creeps vivants au tick courant

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        # reset complet de la room
        subprocess.run([sys.executable, "reset.py"], check=True)
        self._wait_tick(3)

        # 🔄 remise à zéro des compteurs
        self._tick = 0
        self._first_spawn_tick = None
        self._creeps_seen = 0

        # état initial

        self._wait_tick()  # 1) le serveur termine le tick N

        obs = self._get_obs()  # 2) LIRE dqn_state/dqn_creep_count du tick N

        self._inject_state_snippet()  # 3) PROGRAMMER la mesure pour le tick N+1

        self._prev_state = obs.copy()
        return obs, {}

    def step(self, action: int):
        act_obj = ACTIONS[action]

        # ① SPAWN éventuel
        if act_obj["type"] == "SPAWN":
            role = act_obj["role"]
            parts = ",".join(act_obj["body"])
            body = (
                "const room=Object.values(Game.rooms).find(r=>r.controller && r.controller.my);"
                "if(room){{"
                " const sp=_.find(Game.spawns,s=>!s.spawning);"
                " if(sp && room.energyAvailable>=200){{"
                f"  sp.spawnCreep([{parts}],`{role[0].upper()}_${{Game.time}}`,"
                f"     {{ memory: {{ role:'{role}' }} }});"
                " }}"
                "}}"
            )
            self._console(js_iife(body))

        self._wait_tick()

        obs = self._get_obs()
        self._inject_state_snippet()
        time.sleep(0.01)

        # ④ lire l’état MAJ
        obs = self._get_obs()

        # ⑤ compteurs & reward
        self._tick += 1
        creep_cnt = self._get_creep_count()
        if self._first_spawn_tick is None and creep_cnt > 0:
            self._first_spawn_tick = self._tick
        self._creeps_seen = creep_cnt
        if DEBUG_RCL:
            print(
                f"[DBG] tick={self._tick+1:4}  ctrl_lvl={obs[3]}  creeps={self._creeps_seen}"
            )
        reward = self._compute_reward(self._prev_state, obs, act_obj)
        self._prev_state = obs.copy()

        terminated = bool(obs[3] >= 2)  # RCL 2 atteint
        truncated = False  # TimeLimit se charge du reste

        info = {}
        if terminated:
            info["creeps_until_lvl2"] = self._creeps_seen
            info["ticks_until_lvl2"] = self._tick - self._first_spawn_tick

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
        js = js_iife(
            f"""
            const room = Object.values(Game.rooms).find(r => r.controller && r.controller.my);
            if (room) {{
                const e  = room.energyAvailable >= 200 ? 1 : 0;
                const h  = _.sum(_.filter(Game.creeps, c => c.memory.role === 'harvester')
                                .map(c => c.getActiveBodyparts(WORK)));
                const u  = _.sum(_.filter(Game.creeps, c => c.memory.role === 'upgrader')
                                .map(c => c.getActiveBodyparts(WORK)));
                const cl = room.controller.level;
                const cp = Math.floor(room.controller.progress / 100);

                Memory.dqn_state       = JSON.stringify([e, h, u, cl, cp]);

                Memory.dqn_creep_count = Object.keys(Game.creeps).length;
            }}
            """
        )
        self._console(js)

    def _get_obs(self) -> np.ndarray:
        try:
            raw = self.api.memory("dqn_state", shard=self.shard)
        except Exception:
            raw = None
        mem = _to_list(raw)
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

    # ── nombre de creeps ──────────────────────────────────────────────────
    def _get_creep_count(self) -> int:
        raw = self.api.memory("dqn_creep_count", shard=self.shard)

        if isinstance(raw, Mapping):  # OrderedDict {'ok':1,'data':0}
            raw = raw.get("data", 0)  # ← on prend la bonne clé

        while isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                break

        return int(raw or 0)
