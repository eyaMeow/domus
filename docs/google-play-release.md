# Google Play release checklist

The clients now have permanent package-ID candidates under the namespace provided (`noxel.app`). Treat these IDs as final once either app is first published:

- Flutter: `app.noxel.domus.flutter`
- React Native: `app.noxel.domus.reactnative`

These are separate Play Store apps. Confirm that you control `noxel.app` before publishing.

## Production backend

The recommended low-cost setup is Render for the API, Supabase PostgreSQL for application data, and the `listing-photos` Supabase Storage bucket for listing photos. Free tiers may sleep or pause and are for testing, not guaranteed always-on production.

1. Make sure a GitHub repository contains the complete `backend` folder, including its Dockerfile, `src/schema.postgres.sql`, `package.json`, and lockfile. Connect that repository to Render and create a Docker web service with `backend` as its root directory. Render must deploy the same repository version as the mobile apps.
2. In Render, set the API's production environment variables: `DATABASE_URL` (Supabase PostgreSQL connection string with SSL), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET=listing-photos`. Keep the service-role key only in Render's secret environment settings; never put it in mobile app configuration or commit it.
3. Also set a random `DOMUS_JWT_SECRET` of at least 32 characters, `DOMUS_ADMIN_EMAIL`, a strong `DOMUS_ADMIN_PASSWORD`, `CORS_ORIGIN`, and the SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and optionally `SMTP_SECURE`). Enter secrets directly in the hosting dashboard, not in chat or source files.
4. Confirm the Supabase bucket is public for image display and that the Supabase database is active. The API initializes its schema on first production startup and does not insert demo accounts or listings. It does not import data from your local SQLite database.
5. After Render deploys, open `https://<your-render-service>.onrender.com/health`. Configure the React Native and Flutter release builds with this exact HTTPS API URL, then test registration/email verification, login, uploads, listing search, reports, and account deletion on real devices.

The included `compose.yaml` is an alternative for a VPS with Docker and Docker Compose; it still requires the Supabase database/storage and the same production environment variables. Production files are not stored in the container. Back up Supabase data and test restoring it before accepting public users.

## Map, notifications, and email

Some production services require accounts or credentials that the publisher must create:

- **Maps:** OpenFreeMap's Liberty style is used through MapLibre and requires no Google Maps key. React Native builds must include the MapLibre native module; Expo Go cannot run this build. Test the map, location permission prompts, and listing-coordinate flows in the actual Android release build.
- **Notifications:** notifications are local-only and require no Firebase/EAS project or credentials. While the app is open, it checks for server activity every 15 seconds and can show a local alert; remote alerts while the app is closed require a separately configured push provider and are not included.
- **Email:** configure an SMTP sender for your domain, then set the SMTP host, port, username, password, and verified sender in Render or `.env.production`.

The map displays precise coordinates selected by listing owners; it does not display a textual street address. The app also uses device location only after the user requests it to center the map and calculate nearby distances. Complete the Play Data safety form and privacy policy to describe this location use, map-tile requests, account details, messages, and listing photos.

## Store requirements

- Create and safely back up a Play App Signing upload key. Never commit signing keys or passwords.
- Host the privacy policy at a public URL and put that URL in Play Console and in the app. Complete the Data safety form accurately for account details, messages, listing photos, and enabled SDKs.
- Provide account deletion both in the app and through a public web URL before publishing accounts that can be created.
- Provide original app icons, feature graphic, phone screenshots, store description, support contact, content rating, target-audience declaration, and ads declaration. Review current target API and testing requirements at release time.
- Test signed releases on supported Android versions and screen sizes, including offline/error states, email verification, account creation/login, listing photos, chat, account deletion, and API HTTPS connectivity.

## Build outputs

- React Native: set `EXPO_PUBLIC_API_URL` to the deployed HTTPS API URL in the build environment, then build a signed Android release using the configured native MapLibre setup.
- Flutter: set `DOMUS_API_URL` to the deployed HTTPS API URL using local build configuration, configure `android/key.properties`, then run `flutter build appbundle --release`.

The Flutter AAB has not yet been verified in this environment because Gradle's distribution download stalled. Version codes must increase for each Play release. Privacy and terms files in `docs/` are templates and need publisher details, public URLs, and legal review.
