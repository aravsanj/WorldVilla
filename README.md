# WorldVilla

A local-first desktop workspace for building fictional worlds and writing stories.

## Development

```bash
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Desktop packaging

Create an unpacked local app for smoke testing:

```bash
npm run package:dir
```

Build a platform-native distributable (DMG/ZIP on macOS, NSIS/ZIP on Windows, AppImage/DEB on Linux):

```bash
npm run package
```

Artifacts are written to `release/`. Production releases must be code-signed and notarized with platform-specific credentials; unsigned local builds are intended only for development and testing.

## Workspace format

A WorldVilla project is an ordinary folder owned by its user:

```text
My World/
  world.json             # workspace manifest
  lore/                  # Markdown/YAML content (Phase 1)
  manuscript/            # scenes and chapters (Phase 2)
  media/
  maps/
  canvases/
  .worldvilla/
    index.sqlite         # future, rebuildable search index
    snapshots/
    settings.json
```

The first app version creates and opens workspaces. It does not require an account or network connection.
