import subprocess
import os

NEXA_HOST = "212.47.79.52"
NEXA_USER = "root"
NEXA_KEY = os.path.expanduser(r"~/.ssh/nexa_vps")

def run_remote_python(code: str):
    cmd = [
        "ssh", "-i", NEXA_KEY,
        "-o", "StrictHostKeyChecking=no",
        f"{NEXA_USER}@{NEXA_HOST}",
        "python3"
    ]
    res = subprocess.run(cmd, input=code, text=True, capture_output=True, encoding="utf-8")
    print("STDOUT:", res.stdout)
    print("STDERR:", res.stderr)
    return res

script = '''
import subprocess

sql = """
UPDATE users SET created_at = NOW() WHERE created_at IS NULL;
UPDATE users SET hashed_password = '$2b$12$LAAY.F9Q6g8ASz0wHoO9OevhVnSzZeRyebXonOSuRFvA/.LsYkSVq', created_at = COALESCE(created_at, NOW()) WHERE email = 'admin@stalfe.com';
INSERT INTO users (id, account_id, email, hashed_password, first_name, last_name, role, is_active, created_at)
SELECT 'a0000000-0000-0000-0000-000000000001', account_id, 'admin@docurama.com', '$2b$12$LAAY.F9Q6g8ASz0wHoO9OevhVnSzZeRyebXonOSuRFvA/.LsYkSVq', 'Docurama', 'Admin', 'admin', true, NOW()
FROM users WHERE email = 'admin@stalfe.com'
ON CONFLICT (email) DO UPDATE SET hashed_password = EXCLUDED.hashed_password, created_at = COALESCE(users.created_at, NOW());
"""

p = subprocess.run(
    ["docker", "exec", "-i", "docurama-postgres", "psql", "-U", "docurama", "-d", "docurama"],
    input=sql, text=True, capture_output=True
)
print("PSQL OUT:", p.stdout)
print("PSQL ERR:", p.stderr)

p2 = subprocess.run(
    ["docker", "exec", "-i", "docurama-postgres", "psql", "-U", "docurama", "-d", "docurama", "-c", "SELECT id, email, first_name, role FROM users;"],
    text=True, capture_output=True
)
print(p2.stdout)
'''

if __name__ == "__main__":
    run_remote_python(script)
