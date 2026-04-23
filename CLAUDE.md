# onecodex notes

Electron desktop wrapper focused on local `codexapp` supervision.

Key directories:

- `app/main`: desktop orchestration and platform adapters
- `app/preload`: renderer bridge
- `ui-shell`: static UI
- `ops`: bundle preparation and packaging

Primary commands:

- `npm run check`
- `npm run build`
- `npm run bundle:runtime -- --platform win32 --arch x64`
- `npm run dist:win:x64`
