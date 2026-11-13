# Domus

Domus is a Tunisian real-estate marketplace built from the supplied mobile mockups. It includes a React Native (Expo) app, a Flutter app, and one shared HTTP API. Local development uses SQLite and local photo files; production uses Supabase PostgreSQL and Supabase Storage.

## Run locally

Requirements: Node.js 24+, Flutter 3.47+, Android Studio/Android SDK for Android builds.

1. Start the API:

   ```powershell
   cd backend
   npm start
   ```

   The first start creates `backend/data/domus.sqlite` and seeds sample listings. The demo account is `demo@domus.tn` / `Domus2026`.

2. In a second terminal, start either client:

   ```powershell
   cd domus_react_native
   Copy-Item .env.example .env
   # For an Android emulator, the API default is 10.0.2.2; for a phone, set .env to your computer's LAN IP.
   npm run android
   ```

   ```powershell
   cd domus_flutter
   flutter run --dart-define=DOMUS_API_URL=http://10.0.2.2:4000
   ```

Both apps use `http://10.0.2.2:4000` for an Android emulator and `http://localhost:4000` elsewhere by default. For Expo Go on a physical Android phone, set `EXPO_PUBLIC_API_URL` in `.env` to your computer's LAN IP (for example `http://192.168.1.20:4000`) and ensure the phone and computer share a network. For Flutter, pass that same URL with `--dart-define=DOMUS_API_URL=http://192.168.1.20:4000`.

The API health check is `GET http://localhost:4000/health`. Seed data and the demo password are for local development only. Production deployment uses Supabase PostgreSQL and the existing public `listing-photos` bucket; see [docs/google-play-release.md](./docs/google-play-release.md). Production does not write database files or photos to the API container's local disk.

## Included in this first release

- Shared API and persistent database data for accounts, listings, favorites, conversations, messages, and notifications. Local mode uses SQLite; production mode uses Supabase PostgreSQL and Storage. Authenticated uploads support up to 10 JPEG/PNG/WebP property photos per listing.
- Email/password registration and login, listing search and details, favorites, listing publication/editing, pause/resume and owner deletion, profile updates, account deletion, and property conversations.
- Listing reports reviewed in an administrator console. Admins can permanently ban accounts, delete listings, and resolve or reject reports. A permanent ban blocks future sign-in and removes the account's listings from public view.
- French-first visual styling based on the provided screens.
- Interactive OpenFreeMap discovery using MapLibre, with exact saved listing pins and location-based nearby sorting. Listing pins appear only after an owner selects a precise location.

Production registration requires email verification, which needs SMTP configuration. The app does not provide password recovery or verification-email resend. Admins sign in from the regular login form using the configured `DOMUS_ADMIN_EMAIL` and `DOMUS_ADMIN_PASSWORD`; the returned admin role opens the moderation dashboard. Never commit these credentials. Notifications are local-only and need no Firebase, EAS, or push credentials. The app checks for server activity every 15 seconds while open and can show a local alert; remote alerts while it is closed are not available. Chat refreshes from the shared API every five seconds, and all server-backed data refreshes every 15 seconds and when the app resumes. Production requires `DATABASE_URL`, `SUPABASE_URL`, the server-only `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`, plus SMTP and admin settings. Free hosting plans can sleep or pause; they are suitable for testing but do not guarantee always-on service.

OpenFreeMap requires no provider key. React Native uses MapLibre Native, so run it in a custom Expo development/release build rather than Expo Go. The backend's Supabase service-role key is server-only and must never be added to either mobile app.

The API includes `POST /auth/register`, `POST /auth/login`, and `POST /auth/verify-email`; `GET /properties`, `GET /properties/:id`, `POST /properties`, `PUT|DELETE /my/properties/:id`, and `PATCH /my/properties/:id/status`; `POST /properties/:id/reports`; `POST /uploads`; `GET|PUT|DELETE /favorites/:id`; `GET|POST /conversations`; `GET|POST /conversations/:id/messages`; `GET /notifications`; `PATCH /profile`; `DELETE /account`; and admin routes under `/admin` for user/listing deletion and report review. Protected routes require an authorization token; admin-role tokens are issued through the regular login endpoint.

## Google Play preparation

See [docs/google-play-release.md](./docs/google-play-release.md) before publishing. Release signing, store listing, privacy/data-safety declarations, account deletion, and production service credentials must be completed before submission. Do not expose the local development API directly to the internet or use its demo seed account in production.

Terms and privacy documents in `docs/` are templates only; they need your organization details, legal review, and public HTTPS URLs before store submission. For React Native's Play bundle, configure `EXPO_PUBLIC_API_URL` as an HTTPS URL in EAS, then use `eas build --platform android --profile production` after logging in to Expo Application Services. Flutter rejects HTTP API addresses in release builds.
