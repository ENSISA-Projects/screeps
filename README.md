# screeps AI project

Demo of the game :

https://github.com/user-attachments/assets/1603e87a-926d-4b6d-8544-819db98f230c

## Launch Random, Q-learning, Genetic

Just copy the correct directory version in your game folder.  
Use a macro or do it manually to respawn and continue training.  
TODO : Improvement possible by replacing the macro with API calls.  

## Launch Deep q-learning

Setup the server (setup-server -> Set your steam API KEY in config.yml -> sudo docker compose up -d, then you can connect to the game cli via sudo docker compose exec screeps screeps-launcher cli, to run system.resetAllData() or other commands.),  
start the game and connect yourself to the server.  
Private server -> VPS_HOST (ip) -> SCREEPS_HOST and save it for later, then set your USERNAME.  
Also, copy the js files in the game and place the spawner in room W7N7.  
Connect yourself to the endpoint VPS_HOST:21025/authmod/password/ then set your PASSWORD (connect to steam).  
Set username and password in the .env file (example under) and you're done.  

## Example of .env

```env
VPS_HOST=***
VPS_PORT=22
VPS_USER=debian
VPS_PASSWORD=***
SCREEPS_HOST=21025

USERNAME=***
PASSWORD=***
```

## Deep Q-Learning run

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python dqn-main.py
```

Once train is done (select all the data):

```bash
tensorboard --logdir tb_screeps
```

## Differences between versions

### Random

LVL 1-2  
v1 -> Restrained panel of actions chosen randomly, least advanced.  
v2 -> 33% of spawn rate (more flexible), just another way of coding it sequentially this time.  

LVL 1-3  
v3 -> final version made to revive even if colony suicides, with ratios preventing early death.  

### QLearning

LVL 1-2  
v1 -> Restrained panel of actions chosen from the Q-table, least advanced.  
v2 -> Bad version but lots of utilities functions.  
v3 -> Correct version can be trained or evaluated with Memory.eval=True|False.  

LVL 1-3  
v4 -> Final version made to revive even if colony suicides.  

### Genetic

LVL 1-2  
v1 -> Basic implementation of the algorithm (perfect to optimize sequences of actions with constraints but too long).  

### Deep

LVL 1-2  
Only one version available as training further takes too much time, you can read the results of training with tensorboard.  
Similar to Qlearning way of implementation using API calls and MLP policy of DQN (stable baselines3) on vectorized environment gym. Correctly auto reset room W7N7 and continue to iterate.  
Saves datas like reward in logs and for each iteration datas in tb_screeps.  
Saves model in dqn_spawn.  

LVL 1-3?
