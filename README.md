# Ski Trip Leaderboard

Simple static leaderboard to track top ski/snowboard speeds and highest BAC values. Designed to be hosted on GitHub Pages.

Usage
- Open `index.html` in a browser (or enable GitHub Pages for the repository).
- Sign in by entering a username (no password).
- Submit speed (km/h) or BAC (%) — the app stores each user's highest recorded value.

Persistence
- Local: By default the site stores data in each visitor's browser via `localStorage`.
- Optional cross-user sync: configure Firebase and implement syncing. See `config.example.js`.

To publish on GitHub Pages
1. Push this repository to GitHub.
2. In the repo settings enable GitHub Pages from the `main` branch (or `gh-pages`).

Privacy and safety
- This project stores minimal data (username + numbers). Do not publish sensitive personal data.
