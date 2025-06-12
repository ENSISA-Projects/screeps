from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor
from ScreepsSpawnEnv import ScreepsSpawnEnv
from gymnasium.wrappers import TimeLimit
from dotenv import load_dotenv
import os

from ScreepsMetricsCallback import ScreepsMetricsCallback

load_dotenv()

try:
    VPS_HOST = os.getenv("VPS_HOST")
    SCREEPS_HOST = os.getenv("SCREEPS_HOST", "21025")
    if VPS_HOST and SCREEPS_HOST:
        HOST = f"{VPS_HOST}:{SCREEPS_HOST}"
    else:
        raise ValueError("❌ VPS_HOST or SCREEPS_HOST missing in .env")

    USERNAME = os.getenv("USERNAME")
    PASSWORD = os.getenv("PASSWORD")
    SECURE = os.getenv("SECURE")

except Exception as e:
    print(e)
    exit(1)


# Environment
def make_env():
    return ScreepsSpawnEnv(
        user=USERNAME,
        password=PASSWORD,
        host=HOST,
        secure=False,
        shard="shard0",
        render_mode=None,
    )


# MAX_STEPS = 500
env = DummyVecEnv([make_env])
env = TimeLimit(env, max_episode_steps=20_000)
env = VecMonitor(env, filename="./logs/monitor.csv")

# Agent
model = DQN(
    "MlpPolicy",
    env,
    verbose=1,
    tensorboard_log="./tb_screeps",
    learning_rate=2.5e-4,
    gamma=0.99,
)

# Callback(s) + training
callback = ScreepsMetricsCallback()

model.learn(total_timesteps=1000, progress_bar=True, callback=callback)

model.save("dqn_spawn")
