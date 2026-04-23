## onecodex architecture

### Layers

1. `ui-shell`
   Renders the desktop control surface with no service logic.

2. `app/preload`
   Exposes a narrow IPC bridge into the browser context.

3. `app/main`
   Owns settings persistence, service supervision, tray/window lifecycle, and browser launching.

4. `ops`
   Fetches `codexUI`, builds a target-specific service bundle, injects runtime assets into packaged output.

### Runtime flow

1. Electron starts `app/main/entry.ts`.
2. `RuntimeLayout` resolves state paths and packaged bundle locations.
3. `SettingsRepository` loads persisted credentials.
4. `ServiceSupervisor` boots the local `codexapp` process and waits for HTTP readiness.
5. `CodexRpcClient` pushes the API key and default model through `/codex-api/rpc`.
6. `WindowShell` and `TrayShell` receive state broadcasts from the supervisor.

### Packaging flow

1. `ops/prepare-bundle.mjs` fetches `accelizero/codexUI#dev`.
2. The script builds `dist` and `dist-cli`.
3. A target-specific service manifest is generated with production-only dependencies.
4. Debug symbols, unused platform binaries, and package locks are removed.
5. `ops/embed-bundle.cjs` copies the prepared Node runtime and service bundle into the packaged app.
