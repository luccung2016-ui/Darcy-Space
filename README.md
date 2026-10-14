# Darcy Space

Personal marketing operations dashboard for planning projects, tasks, schedules, performance and shared resources.

## Production

- Live app: `https://luccung2016-ui.github.io/Darcy-Space/`
- Entry point: `index.html`
- `v5.9.html` is a compatibility redirect for old bookmarks.

## Structure

- `assets/styles.css` — shared design system and responsive layout.
- `js/core.js` — Supabase connection, auth, data store and shared task rules (`daySets`).
- `js/app.js` — UI: Overview, Calendar, Project & Task, Performance, Library, Schedule, forms, quick search.
- `supabase/` — reproducible database schema.
- `automation/` — Telegram reminder state.
- `.github/workflows/` — Pages deployment and Telegram automation.

## Telegram reminders

Reminders run inside Supabase with `pg_cron` + `pg_net` (`supabase/telegram_reminders.sql`):

- Schedule reminders every minute, based on `reminder_minutes`.
- Daily brief at 08:00 and evening recap at 18:00 (Vietnam time).
- Bot token and chat id are stored in Supabase Vault as `telegram_bot_token` and `telegram_chat_id`.

The GitHub workflow `daily-task-reminder.yml` is kept for manual runs only.

## Required GitHub Actions secrets (manual workflow only)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
