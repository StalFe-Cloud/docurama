import os
import sys
import tarfile
import tempfile
import time
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

NEXA_HOST = os.getenv("DOCURAMA_VPS_HOST", "212.47.79.52")
NEXA_USER = os.getenv("DOCURAMA_VPS_USER", "root")
NEXA_KEY = os.path.expanduser(os.getenv("DOCURAMA_VPS_KEY", "~/.ssh/nexa_vps"))


def run_ssh(cmd, check=True):
    ssh_cmd = [
        "ssh",
        "-i", NEXA_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=15",
        f"{NEXA_USER}@{NEXA_HOST}",
        cmd
    ]
    print(f"  [ssh] {cmd}")
    res = subprocess.run(ssh_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.stdout:
        print(res.stdout.strip())
    if res.stderr and res.returncode != 0:
        print("  [stderr]", res.stderr.strip())
    if check and res.returncode != 0:
        raise RuntimeError(f"Remote command failed with code {res.returncode}: {cmd}")
    return res

def run_scp(local_path, remote_path):
    scp_cmd = [
        "scp",
        "-i", NEXA_KEY,
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=15",
        local_path,
        f"{NEXA_USER}@{NEXA_HOST}:{remote_path}"
    ]
    print(f"  [scp] {local_path} -> {remote_path}")
    res = subprocess.run(scp_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"SCP failed with code {res.returncode}: {res.stderr}")
    return res

EXCLUDE_DIRS = {
    "node_modules", ".git", ".pytest_cache", "__pycache__", "dist", "build",
    ".venv", "venv", "env", "storage", "data", "uploads", ".mypy_cache", ".ruff_cache",
    ".superpowers", ".zcode", "docurama", "skills-external",
}

EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".log", ".swp", ".tar.gz")

def should_exclude(rel_path):
    name = rel_path.replace("\\", "/").split("/")[-1]
    if name.endswith(EXCLUDE_SUFFIXES):
        return True
    if name == ".env" or (name.startswith(".env.") and not name.endswith(".example")):
        return True
    if name.endswith((".p12", ".pfx", ".pem", ".key", ".crt")):
        return True
    return False

def create_deploy_archive():
    print("[1/4] Packaging clean Docurama source for Cloud SaaS deployment...")
    temp_tar = os.path.join(tempfile.gettempdir(), "docurama_cloud_deploy.tar.gz")
    if os.path.exists(temp_tar):
        os.remove(temp_tar)

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    with tarfile.open(temp_tar, "w:gz") as tar:
        for root, dirs, files in os.walk(base_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, base_dir)
                if should_exclude(rel_path):
                    continue
                tar.add(full_path, arcname=rel_path)

    print(f"      Archive created: {temp_tar}")
    return temp_tar

def deploy():
    archive_path = create_deploy_archive()
    print("[2/4] Uploading to Nexa VPS /opt/docurama-cloud...")
    remote_tar = "/tmp/docurama_cloud.tar.gz"
    run_scp(archive_path, remote_tar)

    run_ssh("mkdir -p /opt/docurama-cloud")
    run_ssh(f"tar -xzf {remote_tar} -C /opt/docurama-cloud && rm -f {remote_tar}")
    run_ssh("cp -f /opt/docurama-cloud/deploy/cloud/docker-compose.yml /opt/docurama-cloud/docker-compose.yml")

    print("[3/4] Rebuilding and restarting Cloud stack on port 3002...")
    run_ssh("cd /opt/docurama-cloud && docker compose down 2>/dev/null || true")
    run_ssh("cd /opt/docurama-cloud && docker compose up -d --build")

    print("[4/4] Verifying health...")
    time.sleep(6)
    run_ssh("curl -s http://127.0.0.1:3002/api/health")

    if os.path.exists(archive_path):
        os.remove(archive_path)
    print("\nDocurama Cloud deployment complete!")

if __name__ == "__main__":
    deploy()
