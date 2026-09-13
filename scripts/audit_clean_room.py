import os
import sys

# Extensions scanned for typography violations. Binary assets are excluded so that
# byte sequences that happen to decode as a dash cannot raise a false finding.
TEXT_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".json",
    ".md", ".yml", ".yaml", ".txt", ".conf", ".sh", ".ps1", ".example",
}

FORBIDDEN_TERMS = ["docuseal", "docu_seal", "docu seal"]

# U+2014 EM DASH and U+2013 EN DASH are not permitted in Docurama source or copy.
FORBIDDEN_DASHES = {"\u2014": "em-dash (U+2014)", "\u2013": "en-dash (U+2013)"}


def audit_directory(root_dir):
    # Local agent-harness and review scratch state is not product copy; quoting
    # third-party material inside briefs and diffs must not flip the gate.
    exclude_dirs = [
        ".git", "node_modules", "dist", ".pytest_cache", "__pycache__",
        "data", "storage", ".zcode", ".superpowers",
    ]

    term_findings = []
    dash_findings = []
    total_files = 0

    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for f in files:
            if f == "audit_clean_room.py":
                continue
            total_files += 1
            path = os.path.join(root, f)
            ext = os.path.splitext(f)[1].lower()
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read()
            except Exception:
                continue

            lowered = content.lower()
            for term in FORBIDDEN_TERMS:
                if term in lowered:
                    term_findings.append((path, term))

            if ext in TEXT_EXTENSIONS:
                for char, label in FORBIDDEN_DASHES.items():
                    count = content.count(char)
                    if count:
                        line_no = content[: content.index(char)].count("\n") + 1
                        dash_findings.append((path, label, count, line_no))

    print(f"Audited {total_files} files in {root_dir}")

    ok = True

    if term_findings:
        ok = False
        print(f"FAILED: Found {len(term_findings)} references to forbidden terms:")
        for path, term in term_findings:
            print(f" - {path}: matches '{term}'")
    else:
        print("PASSED: 100% CLEAN-ROOM. ZERO mentions of docuseal found!")

    if dash_findings:
        ok = False
        total = sum(item[2] for item in dash_findings)
        print(f"FAILED: Found {total} forbidden dash characters in {len(dash_findings)} file(s):")
        for path, label, count, line_no in dash_findings:
            print(f" - {path}: {count} x {label}, first at line {line_no}")
    else:
        print("PASSED: TYPOGRAPHY CLEAN. Zero em-dashes or en-dashes found!")

    return ok


if __name__ == "__main__":
    target = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    success = audit_directory(target)
    sys.exit(0 if success else 1)
