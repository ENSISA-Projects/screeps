from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor
from ScreepsSpawnEnv import ScreepsSpawnEnv
from gymnasium.wrappers import TimeLimit
from dotenv import load_dotenv
import os

load_dotenv()

try:
    VPS_HOST = os.getenv("VPS_HOST")
    SCREEPS_PORT = os.getenv("SCREEPS_HOST", "21025")
    if VPS_HOST and SCREEPS_PORT:
        HOST = f"{VPS_HOST}:{SCREEPS_PORT}"
    else:
        raise ValueError("❌ VPS_HOST ou SCREEPS_HOST manquant dans .env")
    USER = os.getenv("USER")
    PASSWORD = os.getenv("PASSWORD")
except Exception as e:
    print(e)
    exit(1)


SECURE = False


# Environment
def make_env():
    return ScreepsSpawnEnv(
        user=USER,
        password=PASSWORD,
        host=HOST,
        secure=SECURE,
        shard="shard0",
        render_mode=None,
    )


MAX_STEPS = 500
env = DummyVecEnv([make_env])
env = TimeLimit(env, max_episode_steps=MAX_STEPS)
# reward/length par épisode
env = VecMonitor(env, filename="./logs/monitor.csv")

# Agent
model = DQN(
    "MlpPolicy",
    env,
    verbose=1,
    tensorboard_log="./tb",
    learning_rate=2.5e-4,
    gamma=0.99,
)

# Callback(s) + entraînement
model.learn(
    total_timesteps=1000, progress_bar=True  # nombre total de décisions d'entraînement
)

model.save("dqn_spawn")
