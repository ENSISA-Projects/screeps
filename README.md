# screeps AI project
Demo of the game :

https://github.com/user-attachments/assets/1603e87a-926d-4b6d-8544-819db98f230c


To launch random, Q-learning, genetic :
Just copy the directory in your game folder
Use a macro to respawn and continue training.
TODO : Improvement possible by replacing the macro with API calls

To launch deep learning part :
Start the server, log to ip:21025/authmod/password/
set your password (connect to steam), set the password and your account name in the main and you're done.
Then run :

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Once train is done :

```bash
tensorboard --logdir tb_screeps
```



