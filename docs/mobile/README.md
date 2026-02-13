# Mobile Progress

## Current status (Android first)

- Added Android-specific Tauri config: `src-tauri/tauri.android.conf.json`
- Added iOS placeholder config: `src-tauri/tauri.ios.conf.json`
- Added mobile scripts: `android:check`, `android:init`, `android:dev`, `android:build`, `ios:plan`
- This machine does not have Java configured, so `tauri android init` cannot run yet

## Android setup checklist

1. Install JDK 17+ and set `JAVA_HOME`
2. Install Android Studio (SDK + Platform Tools)
3. Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`)
4. Run `npm run android:check`
5. Run `npm run android:init`
6. Connect emulator/device, then run `npm run android:dev`

## API base URL strategy (Android adaptation WIP)

- Frontend services now support configurable API base URLs:
  - `VITE_NETEASE_API_BASE_URL`
  - `VITE_QQ_API_BASE_URL`
- Optional runtime override via localStorage key:
  - `allmusic_api_base_overrides_v1`
  - shape: `{ "netease": "http://host:3000", "qq": "http://host:3001" }`
- Fallback behavior:
  - Tauri mobile runtime defaults to `http://10.0.2.2:3000/3001` (Android emulator host mapping)
  - Desktop/web fallback remains `http://localhost:3000/3001`
- Local Node/Python API auto-bootstrap is skipped on likely Tauri mobile runtime.

## iOS placeholder notes

- iOS build requires macOS + Xcode
- On Windows, continue building shared frontend/service code first
- Later on macOS, run `npm run tauri ios init -- --ci`
