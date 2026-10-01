# Darcy Space

Personal marketing operations dashboard for planning projects, tasks, schedules, performance and shared resources.

## Production

- Live app: `https://luccung2016-ui.github.io/Darcy-Space/`
- Entry point: `index.html`
- `v5.9.html` is a compatibility redirect for old bookmarks.

## Structure

- `assets/styles.css` — shared design system and responsive layout.
- `js/core.js` — Supabase connection, authentication and core Task/Project data.
- `js/app.js` — Overview, Calendar, Project & Task, Performance, Library and Schedule.
- `supabase/` — reproducible database schema.
- `automation/` — Telegram reminder state.
- `.github/workflows/` — Pages deployment and Telegram automation.

## Required GitHub Actions secrets

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
