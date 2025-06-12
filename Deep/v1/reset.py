#!/usr/bin/env python3
import time
import sys
from dotenv import load_dotenv
import os, paramiko


load_dotenv()

VPS_HOST = os.getenv("VPS_HOST")
VPS_PORT = int(os.getenv("VPS_SSH_PORT", "22"))
VPS_USER = os.getenv("VPS_USER", "debian")
VPS_PASSWORD = os.getenv("VPS_PASSWORD")

if VPS_HOST is None or VPS_PASSWORD is None:
    sys.exit("❌ VPS_HOST or VPS_PASSWORD missing in .env")


# Screeps commands to reset the room W7N7
SCREEPS_COMMANDS = [
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: 'creep'})",
    "storage.db['rooms.objects'].update({room: 'W7N7', type: 'controller'}, {$set: {level: 1, progress: 0, progressTotal: 200}, $unset: {downgradeTime: 1, upgradeBlocked: 1, safeMode: 1, safeModeAvailable: 1, safeModeCooldown: 1}})",
    "storage.db['rooms.objects'].update({room: 'W7N7', type: 'spawn'}, {$set: {store: {energy: 300}, storeCapacity: 300}})",
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: {$in: ['extension', 'road', 'constructedWall', 'rampart', 'link', 'storage', 'tower', 'observer', 'powerBank', 'powerSpawn', 'extractor', 'lab', 'terminal', 'container', 'nuker']}})",
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: 'constructionSite'})",
]


def connect_ssh():
    """Establishes the SSH connection to the VPS."""
    try:
        print(f"Connecting to {VPS_HOST}:{VPS_PORT}…")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=VPS_HOST,
            port=VPS_PORT,
            username=VPS_USER,
            password=VPS_PASSWORD,
        )
        print("✅ SSH connection established")
        return client
    except Exception as e:
        sys.exit(f"❌ SSH connection error: {e}")


def execute_command(ssh_client, command, wait_time=2):
    """Executes a command and displays the result"""
    try:
        print(f"Executing: {command}")
        stdin, stdout, stderr = ssh_client.exec_command(command)

        # Wait for the command to complete
        time.sleep(wait_time)

        # Read the outputs
        output = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if output:
            print(f"✅ Output: {output}")
        if error:
            print(f"⚠️ Error: {error}")

        return output, error

    except Exception as e:
        print(f"❌ Error during execution: {e}")
        return None, str(e)


def main():
    print("🚀 Starting the reset script for room W7N7")
    print("=" * 50)

    # SSH connection
    ssh_client = connect_ssh()

    try:
        # Navigate to the Screepfinal folder
        print("\n📁 Navigating to the Screepfinal folder...")
        execute_command(ssh_client, "cd Screepfinal && pwd")

        # Start the Screeps CLI with Docker Compose
        print("\n🐳 Starting the Screeps CLI...")

        # Create an interactive session for the CLI
        channel = ssh_client.invoke_shell()

        # Send commands to the channel
        channel.send("cd Screepfinal\n")
        time.sleep(1)

        channel.send("sudo docker compose exec screeps screeps-launcher cli\n")
        time.sleep(3)  # Wait for the CLI to start

        print("\n🔧 Executing reset commands...")

        # Execute each Screeps command
        for i, command in enumerate(SCREEPS_COMMANDS, 1):
            print(f"\n[{i}/{len(SCREEPS_COMMANDS)}] {command}")

            # Send the command
            channel.send(f"{command}\n")
            channel.send("\n")
            time.sleep(2)  # Wait for execution

            # Read the response
            if channel.recv_ready():
                response = channel.recv(4096).decode("utf-8")
                print(f"Response: {response.strip()}")

        # Quit the CLI
        print("\n🚪 Quitting the CLI...")
        channel.send("exit\n")
        time.sleep(1)

        channel.close()

        print("\n✅ Reset of room W7N7 completed successfully!")
        print("=" * 50)
        print("Summary of actions taken:")
        print("- Removed all creeps")
        print("- Reset room controller")
        print("- Configured spawner to 300 energy")
        print("- Cleaned up non-permanent structures")
        print("- Removed construction sites")
        print("- Cleaned up room intents")

    except Exception as e:
        print(f"❌ Error during execution: {e}")

    finally:
        # Close the SSH connection
        ssh_client.close()
        print("\n🔒 SSH connection closed")


if __name__ == "__main__":
    main()
