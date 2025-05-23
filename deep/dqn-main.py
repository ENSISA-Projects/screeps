from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv
from ScreepsSpawnEnv import ScreepsSpawnEnv

env = DummyVecEnv([lambda: ScreepsSpawnEnv(
    user="quen", password="1234",
    host="51.210.254.22:21025", secure=False,
    shard="shard0", render_mode="human",
)])

model = DQN("MlpPolicy", env, verbose=1, tensorboard_log="./tb")
model.learn(100_000)
model.save("dqn_spawn")
