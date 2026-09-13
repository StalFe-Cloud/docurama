#!/usr/bin/env python
"""
SBOM inventory generator (ISO-07).

Produces a dependency inventory of the running environment as JSON:
every Python distribution visible to the interpreter (with its version and
purl), plus the frontend's production dependency tree when npm is available.

This is an inventory artifact, not a formal CycloneDX/SPDX document — it
gives the weekly CI run a diffable record of what shipped, which is what the
vulnerability-management control actually needs. CI uploads it as a build
artifact; operators can diff consecutive runs to spot surprise dependencies.

Usage:
  python scripts/sbom.py --output sbom.json
  python scripts/sbom.py --frontend-dir frontend   # default; skipped if absent
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _python_components() -> list:
    """Every installed distribution the backend runtime can see."""
    components = []
    for dist in metadata.distributions():
        name = dist.metadata.get("Name")
        version = dist.version
        if not name:
            continue
        components.append({
            "name": name,
            "version": version,
            "type": "library",
            "purl": f"pkg:pypi/{name.lower()}@{version}",
            "source": "python-runtime",
        })
    return sorted(components, key=lambda c: c["purl"])


def _npm_components(frontend_dir: Path) -> list:
    """Frontend production dependencies via `npm ls --json --omit=dev`."""
    if not (frontend_dir / "package.json").is_file():
        return []
    try:
        proc = subprocess.run(
            ["npm", "ls", "--json", "--omit=dev", "--depth=1"],
            cwd=str(frontend_dir), capture_output=True, text=True, timeout=120,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print(f"npm inventory skipped: {exc}", file=sys.stderr)
        return []
    try:
        tree = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        print("npm ls output was not JSON; skipping npm inventory", file=sys.stderr)
        return []

    components = []

    def walk(deps: dict):
        for name, info in (deps or {}).items():
            version = info.get("version")
            if name and version:
                components.append({
                    "name": name,
                    "version": version,
                    "type": "library",
                    "purl": f"pkg:npm/{name}@{version}",
                    "source": "npm",
                })
            walk(info.get("dependencies") or {})

    walk(tree.get("dependencies") or {})
    return sorted(components, key=lambda c: c["purl"])


def build_sbom(frontend_dir: Path = None) -> dict:
    components = _python_components()
    if frontend_dir is not None:
        components.extend(_npm_components(frontend_dir))
    return {
        "tool": "scripts/sbom.py",
        "inventory_format": "docurama-inventory-1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "component_count": len(components),
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="SBOM inventory generator")
    parser.add_argument("--output", default=None, help="write JSON here (default: stdout)")
    parser.add_argument("--frontend-dir", default=str(REPO_ROOT / "frontend"),
                        help="frontend directory for the npm inventory")
    args = parser.parse_args()

    frontend = Path(args.frontend_dir) if args.frontend_dir else None
    sbom = build_sbom(frontend)
    payload = json.dumps(sbom, indent=2)
    if args.output:
        Path(args.output).write_text(payload)
        print(f"SBOM with {sbom['component_count']} components written to {args.output}",
              file=sys.stderr)
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
