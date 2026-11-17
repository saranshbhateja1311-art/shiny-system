# JEE OneShot OS 4.2.1

An independent application built on the JEE OS 4.5 architecture and design system. It has its own application identity, local storage namespace, curriculum, Capacitor ID and Supabase cloud table.

## Daily learning model

- **One assigned chapter per day.**
- Rotation: **Physics → Chemistry → Mathematics**, repeating in that order while skipping a subject only after its chapters are exhausted.
- Each chapter has exactly **two checkboxes**:
  1. Lecture completed
  2. Question practice completed
- No question-count fields, marks, accuracy fields or extra practice forms.
- Start date is editable in Settings. The default start date is the day the app is first initialized.
- Missed daily chapters carry forward; the app does not silently skip unfinished work.

## Productive features

- Embedded YouTube player inside the app (privacy-enhanced YouTube embed).
- Today dashboard with the daily mission and its two checkboxes.
- Interactive monthly calendar with previous/next month navigation and a Today shortcut.
- Select any date to see its scheduled chapter, subject, status and the two completion checkboxes.
- Calendar status markers for completed, partially completed, today, upcoming and missed work.
- Searchable chapter library with subject filters and in-app playback.
- Focus sprint timer (25-minute focus block, pause and reset).
- Current streak, weekly consistency strip and subject progress.
- Insights view for completed chapters and progress balance.
- Light, dark and system appearance.
- Installable PWA shell with app-shell caching for offline loading; YouTube playback still requires internet.
- Local-first autosave and optional Supabase snapshot sync.
- Separate One Shot OS cloud table with authenticated-user RLS.

## Run on Windows

1. Extract the ZIP.
2. Double-click `start.bat`.
3. The app opens at **http://localhost:4000**.

Requires Node.js 18+.

## Architecture

The app retains the JEE OS-style single-page architecture, delegated event handling, responsive design system, local-first state persistence, Supabase auth/snapshot sync, lightweight Node static server and Capacitor Android wrapper. It is a separate app and does not write to JEE OS data.

## Cloud sync

Uses the configured Supabase project and `public.jee_one_shot_progress`. The table and per-user RLS policies have already been created. Sign in or create an account from **Cloud sync**. If email confirmation is enabled in Supabase Auth, confirm the account before signing in. The app reports cloud sync errors instead of silently claiming success.

## Android

`android-build.bat` creates/syncs the Capacitor Android project and builds a debug APK when Android SDK + Java are installed. GitHub Actions workflow is included.

## Data files

- `tracker.json` — ordered 116-chapter curriculum and YouTube URLs.
- `curriculum.json` — curriculum metadata.
- `app.js` — daily rotation, checkboxes, player, productivity features and sync.
- `server.js` — local static server on port 4000.
- `SUPABASE-SCHEMA.sql` — dedicated cloud table schema.

## Windows server launcher (v4.2.1)

The Windows launcher now follows the original JEE OS startup pattern: `start.bat` starts a separate minimized CMD server window, waits for the `/health` endpoint, and opens the browser only after the server is ready. JEE OneShot OS uses `http://127.0.0.1:4000/` so it can run alongside the original JEE OS on port 3000.
