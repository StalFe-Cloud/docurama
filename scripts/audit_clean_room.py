import os
import sys

def audit_directory(root_dir):
    forbidden = ["docuseal", "docu_seal", "docu seal"]
    exclude_dirs = [".git", "node_modules", "dist", ".pytest_cache", "__pycache__"]
    
    findings = []
    total_files = 0

    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for f in files:
            if f == "audit_clean_room.py":
                continue
            total_files += 1
            path = os.path.join(root, f)
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read().lower()
                    for term in forbidden:
                        if term in content:
                            findings.append((path, term))
            except Exception:
                pass

    print(f"Audited {total_files} files in {root_dir}")
    if findings:
        print(f"FAILED: Found {len(findings)} references to forbidden terms:")
        for path, term in findings:
            print(f" - {path}: matches '{term}'")
        return False
    else:
        print("PASSED: 100% CLEAN-ROOM. ZERO mentions of docuseal found!")
        return True

if __name__ == "__main__":
    target = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    success = audit_directory(target)
    sys.exit(0 if success else 1)
