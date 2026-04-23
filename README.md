## onecodex

`onecodex` is a desktop control station for launching a local `codexapp` bundle.

The application scope is intentionally narrow:

1. Persist an OpenAI API key, default model, and preferred port.
2. Supervise an embedded `codexapp` runtime with a bundled Node executable.
3. Expose a small Electron control panel and tray menu.
4. Open the browser only after the local service is ready.

### Repository layout

- `app/main`: main-process domain, orchestration, and platform adapters.
- `app/preload`: isolated bridge exported to the browser shell.
- `ui-shell`: static control surface loaded through `file://`.
- `ops`: bundle preparation and packaging hooks.

### Development

```bash
npm install
npm run build
npm run bundle:runtime -- --platform win32 --arch x64
npm run dist:win:x64
```

### Runtime bundle source

Default upstream for bundle preparation:

- Repo: `https://github.com/accelizero/codexUI.git`
- Branch: `dev`

Optional environment overrides:

- `ONECODEX_SOURCE_DIR`
- `ONECODEX_SOURCE_REPO`
- `ONECODEX_SOURCE_BRANCH`
- `ONECODEX_CODEX_PACKAGE`
- `ONECODEX_NODE_VERSION`
