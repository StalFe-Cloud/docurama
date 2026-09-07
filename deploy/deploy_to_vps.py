import os
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
import tarfile
import tempfile
import time
import paramiko

def create_deploy_archive():
    print("[1/5] Packaging clean-room Docurama source code...")
    temp_tar = os.path.join(tempfile.gettempdir(), "docurama_clean_deploy.tar.gz")
    if os.path.exists(temp_tar):
        os.remove(temp_tar)
        
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    exclude = {"node_modules", ".git", ".pytest_cache", "__pycache__"}
    
    with tarfile.open(temp_tar, "w:gz") as tar:
        for root, dirs, files in os.walk(base_dir):
            dirs[:] = [d for d in dirs if d not in exclude]
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, base_dir)
                tar.add(full_path, arcname=rel_path)
                
    size_mb = os.path.getsize(temp_tar) / 1024 / 1024
    print(f"      Archive created: {temp_tar} ({size_mb:.2f} MB)")
    return temp_tar

def deploy():
    archive_path = create_deploy_archive()
    
    print("[2/5] Establishing SSH Jump Tunnel (Switch-VPS -> Nexa-VPS)...")
    jump_client = paramiko.SSHClient()
    jump_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    jump_client.connect("109.199.110.49", username="root", key_filename=os.path.expanduser(r"~/.ssh/id_vps"))
    
    jump_transport = jump_client.get_transport()
    jump_channel = jump_transport.open_channel("direct-tcpip", ("212.47.79.52", 22), ("127.0.0.1", 0))
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect("212.47.79.52", username="root", key_filename=os.path.expanduser(r"~/.ssh/nexa_vps"), sock=jump_channel)
    print("      SSH Connected to Nexa-VPS successfully.")

    print("[3/5] Uploading and extracting clean-room Docurama stack to /opt/docurama...")
    sftp = ssh.open_sftp()
    remote_tar = "/tmp/docurama_clean.tar.gz"
    sftp.put(archive_path, remote_tar)
    sftp.close()
    
    commands = [
        "cd /opt/docurama && docker compose down 2>/dev/null || true",
        "tar -xzf /tmp/docurama_clean.tar.gz -C /opt/docurama && rm -f /tmp/docurama_clean.tar.gz",
        "mkdir -p /opt/docurama/backend/certs"
    ]
    for cmd in commands:
        stdin, stdout, stderr = ssh.exec_command(cmd)
        stdout.channel.recv_exit_status()

    print("[4/5] Building and launching completely isolated Docurama stack (Port 3002, network docurama_net)...")
    build_and_up_cmd = "cd /opt/docurama && docker compose build && docker compose up -d"
    stdin, stdout, stderr = ssh.exec_command(build_and_up_cmd)
    
    for line in iter(stdout.readline, ""):
        safe_line = line.strip().encode("ascii", errors="replace").decode("ascii")
        print("  [docker]", safe_line)
    exit_status = stdout.channel.recv_exit_status()
    if exit_status != 0:
        print("ERROR during docker compose build/up:", stderr.read().decode("utf-8", errors="replace"))
        sys.exit(1)

    print("\n[5/5] Updating Nexa Nginx reverse proxy to point to isolated 172.17.0.1:3002...")
    nginx_update_cmd = """
    sed -i 's/server docurama:3000;/server 172.17.0.1:3002;/' /opt/nexa/infra/nginx/conf.d/docurama.conf
    docker exec nexa-nginx nginx -s reload
    """
    stdin, stdout, stderr = ssh.exec_command(nginx_update_cmd)
    stdout.channel.recv_exit_status()

    print("Waiting 10s for services to stabilize...")
    time.sleep(10)

    # Verification
    print("\n=== RUNNING CONTAINERS ===")
    stdin, stdout, stderr = ssh.exec_command("docker ps --filter 'name=docurama' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'")
    print(stdout.read().decode('utf-8'))

    print("=== LOCAL PORT 3002 HEALTH ===")
    stdin, stdout, stderr = ssh.exec_command("curl -s http://127.0.0.1:3002/api/health")
    print(stdout.read().decode('utf-8'))

    print("\n=== PUBLIC HTTPS ENDPOINT (https://docurama.example.com/api/health) ===")
    stdin, stdout, stderr = ssh.exec_command("curl -s https://docurama.example.com/api/health")
    print(stdout.read().decode('utf-8'))

    print("\n=== PUBLIC HTTPS ROOT (https://docurama.example.com/) ===")
    stdin, stdout, stderr = ssh.exec_command("curl -sI https://docurama.example.com/ | head -n 6")
    print(stdout.read().decode('utf-8'))

    ssh.close()
    jump_client.close()
    if os.path.exists(archive_path):
        os.remove(archive_path)
    print("\nDocurama Isolated Clean-Room Deployment Complete!")

if __name__ == "__main__":
    deploy()
