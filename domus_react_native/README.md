# Domus React Native

## Local notifications

Open **Profil → Paramètres** and enable **Notifications locales** to grant device permission. Domus creates local alerts when new server notifications are fetched while the app is active. No Firebase, EAS project, push token, or notification API credentials are required. Remote notifications while the app is closed are not supported.

## OpenFreeMap / MapLibre

The map uses OpenFreeMap's Liberty style through MapLibre Native and requires no API key. MapLibre adds native code and is not included in Expo Go; rebuild the app after installing it. For local Android development, run `npx expo run:android`, then start Metro with `npm start` and open the installed development build. For Play Store releases, use an EAS production build. A browser build does not include the native map.

The map displays only listings with coordinates chosen by their owners. Tapping the map in the listing form saves the selected coordinates with the listing; device location is requested only when the user chooses **Me localiser**.
