# Changesets

This directory contains changesets — small markdown files that describe changes
to packages. When you make a change that should result in a version bump, run:

```sh
npx changeset add
```

Select the packages affected, choose the semver bump level (patch/minor/major),
and write a brief description. Commit the generated file with your PR.

When the PR merges to `main`, the GitHub Actions release workflow will:

1. Open (or update) a **"Version Packages"** PR that bumps all affected packages
   (and any packages that depend on them) and generates `CHANGELOG.md` entries.
2. When that PR is merged, publish all bumped npm packages automatically.

The VS Code extension (`pretext-tools`) is version-tracked by changesets but
published separately — trigger the **Publish VSCode Extension** workflow manually
after the Version Packages PR merges.
