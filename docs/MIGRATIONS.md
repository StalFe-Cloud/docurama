# Migration notes

Follow the reviewed provider-specific rollout and existing-database handling in
[DEPLOYMENT.md](DEPLOYMENT.md); migration SQL already in release history remains
immutable.

Core migration `20261004_version_default` changes the `PlatformSetting.version`
default for new rows to `0.3.0`, matching the core canonical schema and displayed
admin version. It preserves all existing values, including rows with version
`4.2.1`. PostgreSQL changes the column default; SQLite rebuilds and copies the
platform-settings table without rewriting existing version values. Both provider
histories contain the new reviewed migration.

Enterprise is unchanged: its canonical default remains `4.2.1`, matching its
reviewed baseline. The core migration is not an Enterprise migration.
