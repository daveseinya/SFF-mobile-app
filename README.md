# Saturday Football Family Gala app

## Install as a mobile web app

Host this folder over HTTPS, or use `http://localhost` for local testing. Open the site in a supported mobile browser and choose **Install app** or **Add to Home Screen**. The app shell and static assets are cached for offline use; Jotform submissions still require an internet connection.

## Prepare the Android app

1. Install Node.js, Android Studio, and a compatible Android SDK/JDK.
2. From this folder, run `npm.cmd install`.
3. Run `npm.cmd run android:add` once to create the native Android project.
4. Run `npm.cmd run android:apk` to sync the latest web files and build a debug APK.

The APK is created at `android\app\build\outputs\apk\debug\app-debug.apk`. For a store release, configure a signing key in Android Studio and build a signed release bundle.

## Team registration and approval

A team coordinator can submit a roster of up to 20 players in one application. Each player has their own email, password, optional profile photo, generated SFF ID, and individual approval status. Passwords are stored as scrypt hashes and are never sent to Jotform. Each player must sign in separately after registration.

The Node server stores accounts, teams, and competition details in `data/sff-members.sqlite`. The organizer dashboard at `/admin.html` manages individual player approvals, adds/renames/removes teams from new registrations, and edits the competition title, description, schedule, venue, supported match formats, points system, and announcements. Removed teams and existing player records are retained. Competition details are visible only to approved members; local match results remain device-local.

Jotform receives a team Gala submission when the selected team and match format match its existing form choices. A newly added or renamed team is stored in the SFF backend, but is not forwarded to Jotform until the Jotform form choices are updated.

### Run the app and approval server

1. Use Node.js 22.5 or newer (the server uses the built-in SQLite module).
2. Copy `.env.example` to `.env` and set `SFF_ADMIN_PASSWORD` to a long, unique password. Never commit `.env` or send the password in chat.
3. Run `npm.cmd start`. The app and API are available at `http://127.0.0.1:8080`; registration approval is at `http://127.0.0.1:8080/admin.html`.
4. For deployment, use HTTPS and set `SFF_ALLOWED_ORIGINS` to the exact web-app and Capacitor origins. Set the `sff-api-base-url` meta tag in `index.html` to the deployed API origin before building the Android app.
5. Run `npm.cmd test` to verify registration, pending access restrictions, and organizer approval locally.

The approval database stores account credentials and statuses; Jotform remains the Gala submission destination. The server does not read private Jotform submissions or expose a Jotform API key. Back up `data/sff-members.sqlite` securely.

### Deploy publicly on Render

`render.yaml` configures a Node web service with a 1 GB persistent disk for the SQLite database. The persistent disk requires a paid Render service; review Render's current pricing before creating it. The workspace is not connected to a Git repository, so first push the contents of this app folder to a private GitHub repository, excluding `.env`, `data`, `node_modules`, and build output.

In Render, create a Blueprint from that repository and confirm the paid service and disk. Render will prompt for `SFF_ADMIN_PASSWORD`; copy the generated local value from `.env` into Render's environment settings without sharing it in chat or source control. After deployment, Render provides an HTTPS `onrender.com` URL you can share. Keep backups of the persistent SQLite database.
