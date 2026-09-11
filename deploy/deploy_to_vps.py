import os
import sys
import tarfile
import tempfile
import time
import subprocess

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

NEXA_HOST = "212.47.79.52"
NEXA_USER = "root"
NEXA_KEY = os.path.expanduser(r"~/.ssh/nexa_vps")

def run_ssh(cmd, check=True):
    ssh_cmd = [
        "ssh",
        "-i", NEXA_KEY,
        "-o", "StrictHostKeyChecking=no",
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
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=15",
        local_path,
        f"{NEXA_USER}@{NEXA_HOST}:{remote_path}"
    ]
    print(f"  [scp] {local_path} -> {remote_path}")
    res = subprocess.run(scp_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"SCP failed with code {res.returncode}: {res.stderr}")
    return res

def preflight_env_check():
    """
    docker-compose.yml reads every secret from .env, so deploying without one now
    fails at compose parse time with an opaque error. Check for it up front and
    explain exactly what to do instead.
    """
    print("[2/6] Verifying runtime configuration on the target...")
    local_env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    has_local = os.path.exists(local_env)

    res = run_ssh("test -f /opt/docurama/.env && echo PRESENT || echo MISSING", check=False)
    has_remote = "PRESENT" in (res.stdout or "")

    if has_local:
        print("      Local .env found; it will be uploaded with the source archive.")
        return
    if has_remote:
        print("      Remote /opt/docurama/.env found; it will be preserved.")
        return

    raise RuntimeError(
        "No .env found locally or at /opt/docurama/.env.\n"
        "Secrets are no longer committed to docker-compose.yml, so the stack cannot start "
        "without one.\n"
        "Create it from .env.example and set at minimum POSTGRES_PASSWORD, "
        "DOCURAMA_DATABASE_URL, DOCURAMA_SECRET_KEY and DOCURAMA_P12_PASSWORD."
    )

# Directories never shipped: build output, local virtualenvs, caches, local agent
# scratch space, and the runtime data the server owns.
EXCLUDE_DIRS = {
    "node_modules", ".git", ".pytest_cache", "__pycache__", "dist", "build",
    ".venv", "venv", "env", "storage", "data", "uploads", ".mypy_cache", ".ruff_cache",
    ".superpowers", ".zcode",
}

# Files never shipped, matched on the archive-relative path.
EXCLUDE_SUFFIXES = (".pyc", ".pyo", ".log", ".swp", ".tar.gz")


def is_secret_path(rel_path):
    """
    True when a path must never leave this machine.

    Deployment secrets belong to the server. A developer's .env carries
    DOCURAMA_ENV=development, a localhost APP_URL and whatever throwaway signing
    certificate they happen to be testing with; shipping it would disable the
    production configuration guard, break every signing link, and re-seal documents
    under a key that lives in a temp folder. tarfile does not consult .gitignore, so
    this has to be stated explicitly.
    """
    parts = rel_path.replace("\\", "/").split("/")
    name = parts[-1]

    # .env in any directory, except the committed example.
    if name == ".env" or (name.startswith(".env.") and name != ".env.example"):
        return True

    # Cookie jars hold live session tokens; gitignored, but tarfile does not read
    # .gitignore, so they have to be named here too.
    if name == "cookies.txt" or name.endswith("_cookies.txt"):
        return True

    # Anything under a certs/ directory other than its README.
    if len(parts) >= 2 and parts[-2] == "certs" and name != "README.md":
        return True

    # Key and certificate material anywhere in the tree.
    if name.endswith((".p12", ".pfx", ".pem", ".key", ".crt", ".cer", ".jks")):
        return True

    return False


def should_exclude(rel_path):
    name = rel_path.replace("\\", "/").split("/")[-1]
    if name.endswith(EXCLUDE_SUFFIXES):
        return True
    return is_secret_path(rel_path)


def assert_archive_carries_no_secrets(tar_path):
    """
    Verify the built artefact rather than trusting the filter that produced it.

    An exclusion rule that silently stops matching is exactly how a secret reaches a
    server, so the finished tarball is inspected and the deploy aborts on any hit.
    Returns the member count.
    """
    offenders = []
    with tarfile.open(tar_path, "r:gz") as tar:
        members = tar.getnames()
        for member in members:
            if is_secret_path(member):
                offenders.append(member)

    if offenders:
        raise RuntimeError(
            "Refusing to deploy: the archive contains files that must never leave this "
            "machine:\n  - " + "\n  - ".join(offenders) +
            "\n\nSecrets belong on the server. Put certificates in "
            "/opt/docurama/backend/certs/ with scp, and keep /opt/docurama/.env there."
        )
    return len(members)


def create_deploy_archive():
    print("[3/6] Packaging clean-room Docurama source code...")
    temp_tar = os.path.join(tempfile.gettempdir(), "docurama_clean_deploy.tar.gz")
    if os.path.exists(temp_tar):
        os.remove(temp_tar)

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    skipped_secrets = 0
    with tarfile.open(temp_tar, "w:gz") as tar:
        for root, dirs, files in os.walk(base_dir):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                full_path = os.path.join(root, f)
                rel_path = os.path.relpath(full_path, base_dir)
                if should_exclude(rel_path):
                    if is_secret_path(rel_path):
                        skipped_secrets += 1
                    continue
                tar.add(full_path, arcname=rel_path)

    member_count = assert_archive_carries_no_secrets(temp_tar)
    size_mb = os.path.getsize(temp_tar) / 1024 / 1024
    print(f"      Archive created: {temp_tar} ({size_mb:.2f} MB, {member_count} files)")
    print(f"      Withheld {skipped_secrets} local secret file(s); verified none in archive.")
    return temp_tar

def deploy():
    print(f"[1/6] Verifying direct SSH to Nexa-VPS ({NEXA_HOST}:22)...")
    run_ssh("echo 'SSH to Nexa-VPS verified.' && uname -a")

    preflight_env_check()

    archive_path = create_deploy_archive()
    
    print("[4/6] Uploading and extracting clean-room Docurama stack to /opt/docurama...")
    remote_tar = "/tmp/docurama_clean.tar.gz"
    run_scp(archive_path, remote_tar)

    run_ssh("cd /opt/docurama && docker compose down 2>/dev/null || true", check=False)
    # Extracting over the deployment now leaves the server's own secrets untouched.
    run_ssh(f"tar -xzf {remote_tar} -C /opt/docurama && rm -f {remote_tar}")
    run_ssh("mkdir -p /opt/docurama/backend/certs")

    # Report what the server actually holds, rather than assuming the deploy provided it.
    run_ssh(
        "test -f /opt/docurama/.env && echo '      .env present on server' || "
        "echo '      WARNING: no .env on server; the stack will not start'",
        check=False,
    )
    run_ssh(
        "test -f /opt/docurama/backend/certs/docurama_document_signing_cert.p12 && "
        "echo '      signing certificate present' || "
        "echo '      WARNING: no signing certificate; documents will complete unsealed'",
        check=False,
    )

    print("[5/6] Building and launching completely isolated Docurama stack (Port 3002, network docurama_net)...")
    run_ssh("cd /opt/docurama && docker compose build --no-cache && docker compose up -d")

    print("      Database migrations run automatically from the API entrypoint.")

    print("\n[6/6] Updating Nexa Nginx reverse proxy to point to isolated 172.17.0.1:3002...")
    nginx_update_cmd = (
        "sed -i 's/server docurama:3000;/server 172.17.0.1:3002;/' /opt/nexa/infra/nginx/conf.d/docurama.conf && "
        "docker exec nexa-nginx nginx -s reload"
    )
    run_ssh(nginx_update_cmd, check=False)

    print("Waiting 10s for services to stabilize...")
    time.sleep(10)

    # Verification
    print("\n=== RUNNING CONTAINERS ===")
    run_ssh("docker ps --filter 'name=docurama' --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}'")

    print("=== MIGRATION LOG ===")
    run_ssh("docker logs docurama-api 2>&1 | grep '\\[migrate\\]' | tail -n 10", check=False)

    print("=== LOCAL PORT 3002 HEALTH ===")
    run_ssh("curl -s http://127.0.0.1:3002/api/health || curl -sI http://127.0.0.1:3002/ | head -n 5")

    print("\n=== PUBLIC HTTPS ENDPOINT (https://docurama.stalfe.com/) ===")
    run_ssh("curl -sI https://docurama.stalfe.com/ | head -n 8")

    if os.path.exists(archive_path):
        os.remove(archive_path)
    print("\nDocurama Isolated Clean-Room Deployment to Nexa-VPS Complete!")

if __name__ == "__main__":
    deploy()
