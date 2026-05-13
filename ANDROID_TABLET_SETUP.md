# Android Tablet Offline Setup — Water Station App

The farm has no internet, so the tablet must be prepared before it goes to the farm.

Best reliable options:

1. PWA from HTTPS GitHub Pages: install once while the tablet has internet, then it runs offline at the farm.
2. True Android APK: best long-term, but this Mac currently does not have Java/Android Studio/Android SDK installed, so APK build tools must be installed first.

Important technical note: opening the app from `http://192.168...` on the tablet is good for testing, but Chrome may block the offline service worker on normal LAN HTTP. For reliable offline caching, use HTTPS, usually GitHub Pages, or build an APK.

## Recommended now: install from GitHub Pages before going to the farm

After the repo is pushed to GitHub and Pages is enabled/deployed:

1. On the Android tablet, while it has internet, open the GitHub Pages URL.
2. Wait until the app fully loads.
3. Chrome menu → `Add to Home screen`.
4. Name it:

```text
محطة المياه
```

5. Open `محطة المياه` from the tablet home screen once while still online.
6. Test offline before going to the farm:
   - Turn off Wi‑Fi/mobile data on the tablet.
   - Open `محطة المياه` from the home screen.
   - Record a small test sale.
   - Enter Manager Mode.
   - Export a backup.
   - Clear the test data after confirming it works.

If it opens and works with Wi‑Fi off, it is ready for the farm.

## At the farm with no internet

Use the app from the tablet home screen. It stores everything locally on the tablet/browser storage.

Daily rule:
- At the end of the day, Manager Mode → `تصدير نسخة احتياطية`.
- Save the backup JSON file on the tablet.
- When you later have internet, upload/send that backup to Google Drive, WhatsApp, or your Mac.

## Local Mac testing only

Use this to test the app on the tablet while both devices are on the same Wi‑Fi:

```bash
cd /Users/aoun7/Desktop/water-station-v1
npm run build
npm run preview -- --host 0.0.0.0
```

Then open the shown network URL on the tablet, for example:

```text
http://192.168.1.125:4173/
```

Again: this LAN URL is for testing. For reliable offline tablet use, install from HTTPS GitHub Pages or build an APK.

## APK path later

To build a real APK later, install:
- Java JDK
- Android Studio
- Android SDK
- Capacitor packages

Then package the Vite app as an Android project and build an APK. This is the cleanest farm-only setup if you do not want to rely on browser PWA caching.
