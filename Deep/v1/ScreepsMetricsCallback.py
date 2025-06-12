from stable_baselines3.common.callbacks import BaseCallback


class ScreepsMetricsCallback(BaseCallback):
    def _on_step(self) -> bool:
        wrote = False
        for info in self.locals["infos"]:
            if "creeps_until_lvl2" in info:
                self.logger.record("screeps/creeps_to_RCL2", info["creeps_until_lvl2"])
                wrote = True
            if "ticks_until_lvl2" in info:
                self.logger.record("screeps/ticks_to_RCL2", info["ticks_until_lvl2"])
                wrote = True
        if wrote:
            # flush in event-file visible in TensorBoard
            self.logger.dump(self.num_timesteps)
        return True
