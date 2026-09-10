"""
Every name an API module imports from app.models must actually be exported.

This class of failure keeps escaping the host suite: the developer environment cannot
import API modules (its FastAPI and starlette disagree), so a missing export only
surfaces when the container starts and crash-loops with an ImportError. Parsing the
imports statically catches it here instead, without needing the web framework.
"""
import ast
import io
import pathlib

import pytest

BACKEND = pathlib.Path(__file__).resolve().parent.parent
API_DIR = BACKEND / "app" / "api"
SERVICES_DIR = BACKEND / "app" / "services"


def _exported_names():
    from app import models
    return set(getattr(models, "__all__", []) or dir(models))


def _modules_importing_models():
    for directory in (API_DIR, SERVICES_DIR):
        for path in sorted(directory.glob("*.py")):
            if path.name == "__init__.py":
                continue
            yield path


def _names_imported_from_models(path: pathlib.Path):
    """Return the names a module pulls out of app.models, via AST rather than regex."""
    tree = ast.parse(io.open(path, encoding="utf-8").read())
    names = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in ("app.models", "app.models.models"):
            for alias in node.names:
                if alias.name != "*":
                    names.append(alias.name)
    return names


@pytest.mark.parametrize(
    "module_path",
    list(_modules_importing_models()),
    ids=lambda p: p.name,
)
def test_model_imports_are_exported(module_path):
    exported = _exported_names()
    missing = [n for n in _names_imported_from_models(module_path) if n not in exported]

    assert not missing, (
        f"{module_path.name} imports {missing} from app.models, which does not export "
        f"them. The container will crash-loop on start with an ImportError."
    )
