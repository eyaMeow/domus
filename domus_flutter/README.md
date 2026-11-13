# Domus Flutter

## Local notifications

Open **Profil → Paramètres** and enable **Notifications locales** to grant device permission. Domus creates local alerts when new server notifications are fetched while the app is active. No Firebase, push token, or API provider configuration is needed for local scheduling. Remote notifications while the app is closed are not supported.

## Local development

Use the API environment options documented in the root project README when connecting to a backend.

## OpenFreeMap / MapLibre

The app uses OpenFreeMap's Liberty style through MapLibre and needs no map-provider API key. Ensure the device has internet access to load the style and map tiles. The map shows only listings with owner-selected coordinates; tapping the map in the listing form saves that exact location with the listing. Device location is requested only when the user chooses **Me localiser**.
