"""
Apply database migrations on startup.

Docurama previously built its schema with Base.metadata.create_all() plus two ad-hoc
ALTER TABLE statements wrapped in a bare except. That left no record of what had been
applied, so this runner adopts the existing production database into Alembic:

  * fresh database          -> run every migration from scratch
  * pre-existing, unstamped -> reconcile to the baseline, stamp it, then apply anything newer
  * already stamped         -> upgrade to head

The reconcile step matters. A database built by the old create_all path can be missing
both tables and columns that the baseline declares:

  * create_all only ever created tables absent at the time, so a table added to the
    models later was never created against an older database.
  * columns added to an existing table were applied by ad-hoc ALTER TABLE statements
    in the application's startup path, which no longer run.

Stamping such a database would record all of that as present. Missing baseline tables
and columns are therefore reconciled first, reproducing what the old startup path
would have produced, and only then is the baseline stamped.

Safe to run on every container start; upgrading an up-to-date database is a no-op.
"""
import os
import sys
import time

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

BASELINE_REVISION = "0001_baseline"
# Present in the baseline schema, so its existence means the database predates Alembic.
SENTINEL_TABLE = "accounts"

def _baseline_schema():
    """
    Read the exact tables and columns that revision 0001_baseline creates.

    The baseline file is executed against a recorder that captures its
    op.create_table calls, rather than being parsed or approximated from the current
    models. The models move on with every revision, so deriving the baseline from
    them would sweep later-revision columns into the reconciliation and then collide
    with the migration that is supposed to add them.

    Returns {table_name: {column_name, ...}}.
    """
    import sqlalchemy as sa

    schema = {}

    class _Recorder:
        @staticmethod
        def create_table(name, *args, **kwargs):
            schema[name] = {
                a.name for a in args if isinstance(a, sa.Column)
            }

        def __getattr__(self, _name):
            # create_index, execute and friends are irrelevant to the shape we need.
            return lambda *a, **k: None

    here = os.path.dirname(os.path.abspath(__file__))
    baseline_path = os.path.join(here, "alembic", "versions", f"{BASELINE_REVISION}.py")

    source = open(baseline_path, encoding="utf-8").read()
    namespace = {"__name__": "_baseline_probe"}
    exec(compile(source, baseline_path, "exec"), namespace)
    # The module's own "from alembic import op" replaced anything pre-seeded, so the
    # recorder is bound after execution and before upgrade() is called.
    namespace["op"] = _Recorder()
    namespace["upgrade"]()

    return schema


def _sync_url() -> str:
    from app.core.config import settings
    return settings.SYNC_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


def _wait_for_database(url: str, attempts: int = 30, delay: float = 2.0):
    last_error = None
    for attempt in range(1, attempts + 1):
        try:
            engine = create_engine(url, pool_pre_ping=True)
            with engine.connect():
                pass
            return engine
        except Exception as exc:  # noqa: BLE001 - startup retry loop
            last_error = exc
            print(f"[migrate] database not ready (attempt {attempt}/{attempts}): {exc}")
            time.sleep(delay)
    raise RuntimeError(f"Database never became reachable: {last_error}")


def _reconcile_to_baseline(engine, existing_tables):
    """
    Create any baseline table the database is missing, before it is stamped.

    Only tables belonging to the baseline revision are created here. Tables introduced
    by later revisions must come from those revisions, otherwise the migration that
    adds them would fail against a schema that already has them.

    Returns the sorted names of the tables created.
    """
    from app.core.database import Base
    import app.models.models  # noqa: F401 - registers the tables on Base.metadata

    baseline = _baseline_schema()
    missing = [
        table for name, table in Base.metadata.tables.items()
        if name in baseline and name not in existing_tables
    ]
    if not missing:
        return []

    names = sorted(t.name for t in missing)
    print(f"[migrate] schema predates Alembic and is missing baseline tables: {', '.join(names)}")
    Base.metadata.create_all(bind=engine, tables=missing, checkfirst=True)
    print(f"[migrate] created {len(names)} missing baseline table(s)")
    return names


def _reconcile_baseline_columns(engine, existing_tables):
    """
    Add any baseline column missing from a table that already exists.

    The old startup path applied column additions with ad-hoc ALTER TABLE statements
    that no longer run, so an adopted database can hold a table whose columns stop at
    whatever the models declared when it was created. Stamping over that leaves the
    application querying columns that do not exist.

    Only nullable columns are added. A missing NOT NULL column cannot be filled in
    safely for existing rows, so it is reported and left for an explicit migration.

    Returns the sorted "table.column" names that were added.
    """
    import sqlalchemy as sa
    from sqlalchemy import inspect as sa_inspect
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    from app.core.database import Base
    import app.models.models  # noqa: F401 - registers the tables on Base.metadata

    inspector = sa_inspect(engine)
    baseline = _baseline_schema()
    added = []
    blocked = []

    for name, table in Base.metadata.tables.items():
        if name not in baseline or name not in existing_tables:
            continue

        baseline_columns = baseline[name]
        present = {c["name"] for c in inspector.get_columns(name)}
        for column in table.columns:
            # Only columns the baseline itself declares. A column introduced by a
            # later revision must be added by that revision, or it would collide.
            if column.name not in baseline_columns or column.name in present:
                continue
            if not column.nullable and column.server_default is None:
                blocked.append(f"{name}.{column.name}")
                continue
            added.append((table, column))

    if blocked:
        print(
            "[migrate] WARNING: cannot auto-add non-nullable baseline column(s) "
            f"without a default: {', '.join(sorted(blocked))}"
        )

    if not added:
        return []

    labels = sorted(f"{t.name}.{c.name}" for t, c in added)
    print(f"[migrate] missing baseline columns: {', '.join(labels)}")

    # Alembic's operations API renders the column DDL for the target dialect, which
    # SQLAlchemy alone does not expose outside a migration script.
    with engine.begin() as conn:
        ops = Operations(MigrationContext.configure(conn))
        for table, column in added:
            ops.add_column(
                table.name,
                sa.Column(
                    column.name,
                    column.type,
                    nullable=column.nullable,
                    server_default=column.server_default,
                ),
            )

    print(f"[migrate] added {len(labels)} missing baseline column(s)")
    return labels


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    os.chdir(here)

    url = _sync_url()
    engine = _wait_for_database(url)

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "alembic"))

    if "alembic_version" not in tables and SENTINEL_TABLE in tables:
        print("[migrate] existing schema detected without version tracking")
        _reconcile_to_baseline(engine, tables)
        _reconcile_baseline_columns(engine, tables)
        print(f"[migrate] stamping {BASELINE_REVISION}")
        command.stamp(cfg, BASELINE_REVISION)
    elif "alembic_version" not in tables:
        print("[migrate] fresh database detected; applying all migrations")

    engine.dispose()

    command.upgrade(cfg, "head")
    print("[migrate] database is at head")
    return 0


if __name__ == "__main__":
    sys.exit(main())
