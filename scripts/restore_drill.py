#!/usr/bin/env python
"""
Restore-drill harness (ISO-06).

Restores a database backup into a scratch copy and verifies it without ever
touching the original or the live database:

  1. copy the backup file to a temporary location (the scratch copy),
  2. run SQLite's integrity_check on the copy,
  3. reconcile per-table row counts (optionally against a live baseline),
  4. re-verify the hash-chained audit ledgers on the restored copy -
     the platform-wide security ledger and every per-envelope chain.

The drill exits 0 only when integrity is clean and every chain verifies;
exit 1 means the restore is NOT trustworthy and the drill failed. The JSON
report is written to stdout (or --output) and is what
POST /api/admin/compliance/restore-drills archives as evidence - the API
records what the harness measured; it does not re-run or re-judge it.

Usage:
  python scripts/restore_drill.py --backup docurama-data/backup.db
  python scripts/restore_drill.py --backup backup.db --compare-live docurama-data/docurama.db
  python scripts/restore_drill.py --backup backup.db --output drill-report.json

Run with the project venv so app.* imports resolve:
  /home/z/my-project/.venv/bin/python scripts/restore_drill.py --backup ...
"""
import argparse
import asyncio
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"


def _table_counts(db_path: str) -> tuple:
    """Row counts per user table plus the SQLite integrity verdict."""
    con = sqlite3.connect(db_path)
    try:
        tables = [
            r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' "
                "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'alembic_%' "
                "ORDER BY name"
            )
        ]
        counts = {}
        for t in tables:
            counts[t] = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
    finally:
        con.close()
    return counts, integrity


async def _verify_chains(db_path: str) -> dict:
    """Re-verify every hash chain on the restored copy.

    The DATABASE_URL environment variable is deliberately removed first: it
    poisons module-level configuration and could silently point verification
    at the live database instead of the scratch copy under test.
    """
    os.environ.pop("DATABASE_URL", None)
    if str(BACKEND_DIR) not in sys.path:
        sys.path.insert(0, str(BACKEND_DIR))

    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.models import AuditEvent
    from app.services import audit_chain

    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    maker = async_sessionmaker(bind=engine, expire_on_commit=False)
    result = {"security_ledger": None, "envelopes_checked": 0,
              "envelopes_broken": [], "valid": False}
    try:
        async with maker() as db:
            result["security_ledger"] = await audit_chain.verify_security_chain(db)
            envelope_ids = (await db.execute(
                select(AuditEvent.envelope_id).where(AuditEvent.envelope_id.isnot(None)).distinct()
            )).scalars().all()
            for envelope_id in envelope_ids:
                result["envelopes_checked"] += 1
                verdict = await audit_chain.verify_envelope_chain(db, envelope_id)
                if not verdict.get("valid"):
                    result["envelopes_broken"].append(envelope_id)
            result["valid"] = bool(
                result["security_ledger"].get("valid")
                and not result["envelopes_broken"]
            )
    finally:
        await engine.dispose()
    return result


async def perform_restore_drill(backup_path: str, compare_live: str = None) -> dict:
    """Run the full drill and return the JSON-serialisable report."""
    source = Path(backup_path)
    if not source.is_file():
        return {
            "passed": False,
            "error": f"backup not found: {backup_path}",
            "executed_at": datetime.now(timezone.utc).isoformat(),
        }

    scratch_dir = tempfile.mkdtemp(prefix="docurama-drill-")
    scratch_db = os.path.join(scratch_dir, "restored.db")
    try:
        shutil.copy2(source, scratch_db)
        counts, integrity = _table_counts(scratch_db)
        chains = await _verify_chains(scratch_db)

        report = {
            "tool": "scripts/restore_drill.py",
            "backup_source": str(source),
            "backup_bytes": source.stat().st_size,
            "scratch_copy": scratch_db,
            "sqlite_integrity": integrity,
            "tables_checked": len(counts),
            "rows_recovered": int(sum(counts.values())),
            "row_counts": counts,
            "audit_chain": chains,
            "executed_at": datetime.now(timezone.utc).isoformat(),
        }

        if compare_live:
            live_path = Path(compare_live)
            if live_path.is_file():
                live_counts, _ = _table_counts(str(live_path))
                drift = {}
                for table, restored in counts.items():
                    live = live_counts.get(table)
                    if live is not None and live < restored:
                        # The backup holds MORE rows than the live DB: either
                        # legitimate churn or lost rows since the backup.
                        drift[table] = {"backup": restored, "live": live}
                report["live_comparison"] = {
                    "live_source": str(live_path),
                    "tables_missing_in_live": sorted(
                        t for t in counts if t not in live_counts
                    ),
                    "rows_at_risk": drift,
                }
            else:
                report["live_comparison"] = {"error": f"not found: {compare_live}"}

        report["passed"] = bool(
            integrity == "ok" and chains.get("valid")
        )
        return report
    finally:
        shutil.rmtree(scratch_dir, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore-drill harness (ISO-06)")
    parser.add_argument("--backup", required=True, help="path to the database backup file")
    parser.add_argument("--compare-live", default=None,
                        help="optional live database path for row-count drift comparison")
    parser.add_argument("--output", default=None,
                        help="write the JSON report to this file (default: stdout)")
    args = parser.parse_args()

    report = asyncio.run(perform_restore_drill(args.backup, args.compare_live))
    payload = json.dumps(report, indent=2)
    if args.output:
        Path(args.output).write_text(payload)
        print(f"drill report written to {args.output}", file=sys.stderr)
    else:
        print(payload)

    if report.get("passed"):
        print("RESTORE DRILL PASSED: integrity ok, audit chains verify", file=sys.stderr)
        return 0
    print("RESTORE DRILL FAILED: the restored copy is not trustworthy", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
