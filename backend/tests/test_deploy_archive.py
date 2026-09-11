"""
Deploy archive safety.

The defect this covers: create_deploy_archive() excluded only a handful of directory
names, and tarfile does not consult .gitignore. The archive therefore carried the
developer's .env and whatever sat in backend/certs/, and the extraction step restored
the server's .env only when none existed afterwards, which was never the case. A deploy
would have set production to DOCURAMA_ENV=development with a localhost APP_URL, and
replaced the production signing certificate with a local test one.
"""
import importlib.util
import os
import pathlib
import tarfile
import tempfile

import pytest

DEPLOY_SCRIPT = pathlib.Path(__file__).resolve().parent.parent.parent / "deploy" / "deploy_to_vps.py"

# The runtime image ships only the application, so deploy tooling is absent there by
# design. These run on a developer host, where deployments are actually launched.
pytestmark = pytest.mark.skipif(
    not DEPLOY_SCRIPT.exists(),
    reason="deploy tooling is not part of the runtime image; run this suite on the host",
)


@pytest.fixture(scope="module")
def deploy():
    """Load the deploy script as a module without executing a deployment."""
    spec = importlib.util.spec_from_file_location("deploy_to_vps", DEPLOY_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# Path classification
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("path", [
    ".env",
    ".env.production",
    ".env.local",
    "backend/certs/docurama_document_signing_cert.p12",
    "backend/certs/docurama_root_ca.crt",
    "backend/certs/anything.txt",
    "some/nested/private.key",
    "certs/server.pem",
    "a/b/keystore.jks",
    "cookies.txt",
    "backend/site_cookies.txt",
    "a/b/curl_cookies.txt",
])
def test_secrets_are_recognised(deploy, path):
    assert deploy.is_secret_path(path) is True


@pytest.mark.parametrize("path", [
    ".env.example",
    "backend/certs/README.md",
    "backend/app/main.py",
    "frontend/src/lib/api.ts",
    "docker-compose.yml",
    "README.md",
    "docs/cookies_policy.md",
])
def test_shipped_files_are_not_flagged(deploy, path):
    assert deploy.is_secret_path(path) is False


def test_windows_separators_are_handled(deploy):
    """os.walk yields backslashes on Windows; the classifier must still match."""
    assert deploy.is_secret_path("backend\\certs\\signing.p12") is True
    assert deploy.is_secret_path("backend\\certs\\README.md") is False


# ---------------------------------------------------------------------------
# The guard on the built artefact
# ---------------------------------------------------------------------------

def _make_tar(tmp_path, names):
    payload = tmp_path / "payload.txt"
    payload.write_text("x", encoding="utf-8")
    tar_path = tmp_path / "archive.tar.gz"
    with tarfile.open(tar_path, "w:gz") as tar:
        for name in names:
            tar.add(payload, arcname=name)
    return str(tar_path)


def test_clean_archive_passes(deploy, tmp_path):
    tar_path = _make_tar(tmp_path, ["backend/app/main.py", ".env.example", "backend/certs/README.md"])
    assert deploy.assert_archive_carries_no_secrets(tar_path) == 3


def test_archive_containing_env_is_refused(deploy, tmp_path):
    """If the exclusion filter ever regresses, the artefact check must still catch it."""
    tar_path = _make_tar(tmp_path, ["backend/app/main.py", ".env"])

    with pytest.raises(RuntimeError) as exc:
        deploy.assert_archive_carries_no_secrets(tar_path)
    assert ".env" in str(exc.value)
    assert "Refusing to deploy" in str(exc.value)


def test_archive_containing_a_certificate_is_refused(deploy, tmp_path):
    tar_path = _make_tar(tmp_path, ["backend/certs/docurama_document_signing_cert.p12"])

    with pytest.raises(RuntimeError) as exc:
        deploy.assert_archive_carries_no_secrets(tar_path)
    assert ".p12" in str(exc.value)


def test_every_offender_is_named(deploy, tmp_path):
    """An operator needs the full list, not just the first hit."""
    tar_path = _make_tar(tmp_path, [".env", "backend/certs/root.crt", "backend/app/main.py"])

    with pytest.raises(RuntimeError) as exc:
        deploy.assert_archive_carries_no_secrets(tar_path)
    message = str(exc.value)
    assert ".env" in message
    assert "root.crt" in message


# ---------------------------------------------------------------------------
# The real archive
# ---------------------------------------------------------------------------

def test_the_real_repository_archives_without_secrets(deploy):
    """
    Build the actual deploy archive from this working tree. This is the check that
    would have caught the original defect: the tree currently holds a local .env and
    a test signing certificate, and neither may appear.
    """
    tar_path = deploy.create_deploy_archive()
    try:
        with tarfile.open(tar_path, "r:gz") as tar:
            names = tar.getnames()

        assert names, "archive is empty"
        assert [n for n in names if deploy.is_secret_path(n)] == []
        # The deployment still needs its source and its documented example config.
        assert "backend/app/main.py" in names
        assert ".env.example" in names
    finally:
        if os.path.exists(tar_path):
            os.remove(tar_path)


def test_scratch_dirs_and_cookie_jars_never_enter_the_archive(deploy, tmp_path, monkeypatch):
    """
    git keeps agent scratch directories and cookie jars out of history, but tarfile
    does not consult .gitignore. The builder must drop them itself, the same way it
    drops a developer's .env.
    """
    source = tmp_path / "tree"
    (source / "backend" / "app").mkdir(parents=True)
    (source / "backend" / "app" / "main.py").write_text("x", encoding="utf-8")
    (source / ".superpowers").mkdir()
    (source / ".superpowers" / "brief.md").write_text("x", encoding="utf-8")
    (source / ".zcode").mkdir()
    (source / ".zcode" / "session.json").write_text("x", encoding="utf-8")
    (source / "cookies.txt").write_text("x", encoding="utf-8")
    (source / "backend" / "site_cookies.txt").write_text("x", encoding="utf-8")

    # create_deploy_archive() packages the tree one level above its own module
    # directory, because the real script lives in deploy/. Mirror that layout so
    # the synthetic tree is the archive root.
    monkeypatch.setattr(deploy, "__file__", str(source / "deploy" / "deploy_to_vps.py"))
    tar_path = deploy.create_deploy_archive()
    try:
        with tarfile.open(tar_path, "r:gz") as tar:
            names = [n.replace("\\", "/") for n in tar.getnames()]
    finally:
        if os.path.exists(tar_path):
            os.remove(tar_path)

    assert "backend/app/main.py" in names
    assert not any(n.startswith(".superpowers/") for n in names)
    assert not any(n.startswith(".zcode/") for n in names)
    assert not any(n.split("/")[-1] == "cookies.txt" for n in names)
    assert not any(n.split("/")[-1].endswith("_cookies.txt") for n in names)
