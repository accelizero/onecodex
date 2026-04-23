# Contributing

Keep the project narrow in scope.

Contribution rules:

1. Do not add chat-session logic into the desktop shell.
2. Keep service supervision and UI state separated.
3. Prefer target-specific bundle trimming over larger installer defaults.
4. Validate with `npm run check` before proposing packaging changes.
