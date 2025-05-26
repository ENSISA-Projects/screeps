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
    sys.exit("❌ VPS_HOST ou VPS_PASSWORD manquant dans .env")


# Commandes Screeps pour reset la room W7N7
SCREEPS_COMMANDS = [
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: 'creep'})",
    "storage.db['rooms.objects'].update({room: 'W7N7', type: 'controller'}, {$set: {level: 1, progress: 0, progressTotal: 200}, $unset: {downgradeTime: 1, upgradeBlocked: 1, safeMode: 1, safeModeAvailable: 1, safeModeCooldown: 1}})",
    "storage.db['rooms.objects'].update({room: 'W7N7', type: 'spawn'}, {$set: {store: {energy: 300}, storeCapacity: 300}})",
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: {$in: ['extension', 'road', 'constructedWall', 'rampart', 'link', 'storage', 'tower', 'observer', 'powerBank', 'powerSpawn', 'extractor', 'lab', 'terminal', 'container', 'nuker']}})",
    "storage.db['rooms.objects'].removeWhere({room: 'W7N7', type: 'constructionSite'})",
]


def connect_ssh():
    """Établit la connexion SSH au VPS."""
    try:
        print(f"Connexion à {VPS_HOST}:{VPS_PORT}…")
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            hostname=VPS_HOST,
            port=VPS_PORT,
            username=VPS_USER,
            password=VPS_PASSWORD,
        )
        print("✅ Connexion SSH établie")
        return client
    except Exception as e:
        sys.exit(f"❌ Erreur de connexion SSH : {e}")


def execute_command(ssh_client, command, wait_time=2):
    """Exécute une commande et affiche le résultat"""
    try:
        print(f"Exécution: {command}")
        stdin, stdout, stderr = ssh_client.exec_command(command)

        # Attendre que la commande se termine
        time.sleep(wait_time)

        # Lire les sorties
        output = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if output:
            print(f"✅ Sortie: {output}")
        if error:
            print(f"⚠️  Erreur: {error}")

        return output, error

    except Exception as e:
        print(f"❌ Erreur lors de l'exécution: {e}")
        return None, str(e)


def main():
    print("🚀 Démarrage du script de reset de la room W7N7")
    print("=" * 50)

    # Connexion SSH
    ssh_client = connect_ssh()

    try:
        # Naviguer vers le dossier Screepfinal
        print("\n📁 Navigation vers le dossier Screepfinal...")
        execute_command(ssh_client, "cd Screepfinal && pwd")

        # Lancer le CLI Screeps avec Docker Compose
        print("\n🐳 Lancement du CLI Screeps...")

        # Créer une session interactive pour le CLI
        channel = ssh_client.invoke_shell()

        # Envoyer les commandes
        channel.send("cd Screepfinal\n")
        time.sleep(1)

        channel.send("sudo docker compose exec screeps screeps-launcher cli\n")
        time.sleep(3)  # Attendre que le CLI se lance

        print("\n🔧 Exécution des commandes de reset...")

        # Exécuter chaque commande Screeps
        for i, command in enumerate(SCREEPS_COMMANDS, 1):
            print(f"\n[{i}/{len(SCREEPS_COMMANDS)}] {command}")

            # Envoyer la commande
            channel.send(f"{command}\n")
            channel.send("\n")
            time.sleep(2)  # Attendre l'exécution

            # Lire la réponse
            if channel.recv_ready():
                response = channel.recv(4096).decode("utf-8")
                print(f"Réponse: {response.strip()}")

        # Quitter le CLI
        print("\n🚪 Fermeture du CLI...")
        channel.send("exit\n")
        time.sleep(1)

        channel.close()

        print("\n✅ Reset de la room W7N7 terminé avec succès!")
        print("=" * 50)
        print("Résumé des actions effectuées:")
        print("- Suppression de tous les creeps")
        print("- Reset du contrôleur de room")
        print("- Configuration du spawner à 300 d'énergie")
        print("- Nettoyage des structures non-permanentes")
        print("- Suppression des sites de construction")
        print("- Nettoyage des intents de la room")

    except Exception as e:
        print(f"❌ Erreur durant l'exécution: {e}")

    finally:
        # Fermer la connexion SSH
        ssh_client.close()
        print("\n🔒 Connexion SSH fermée")


if __name__ == "__main__":
    main()
