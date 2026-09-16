# KeepLocal für Android

Nativer Android-Client (Kotlin + Jetpack Compose) für denselben Server wie
das Web-UI (`client/`). Er spricht die identische REST-API — inklusive
Offline-Queue, Bildkompression vor Upload, Hintergrund-Sync und
Karten-Farbsystem mit WCAG-geprüften Kontrasten.

**Aktueller Stand: v1.7.0 (versionCode 23).**

## Bauen

Voraussetzungen: JDK 17, Android SDK (compileSdk 34, minSdk 33).

```bash
cd android
./gradlew assembleDebug      # APK: app/build/outputs/apk/debug/
./gradlew testDebugUnitTest  # 180 Unit-Tests
```

`assembleDebug` hängt automatisch an `testDebugUnitTest` — kaputte Tests
brechen den Build. Die APK ist danach **nur debug-signiert**; für einen
Release-Brauch braucht es einen eigenen Keystore (`signingConfigs`).

Der Server wird in der App beim ersten Start eingetragen (Willkommens-Screen);
Standard ist die eigene Instanz. TLS-Zertifikate, OAuth-Provider und
CSRF-Verhalten entsprechen dem Web-Client.

## Was drin ist

| Bereich | Umfang |
| --- | --- |
| UI | Compose BOM 2024.04, Material 3, Adaptive/Foldable (androidx.window), Tablet-Listen-Detail |
| Architektur | Hilt, MVVM, Room-Cache, Retrofit/OkHttp/Moshi, WorkManager-Hintergrund-Sync |
| Offline | Sync-Queue mit Retry + Konfliktbehandlung (409 → lokale Kopie), Draft-Autosave, Offline-Suche |
| Design | 5 Themes (Light/Dark/OLED/E-Ink/Doodle), Material-You-Schalter, per-Karten-Ink mit Kontrast-Tests |
| Extras | Glance-Widget für angepinnte Notizen, Quick-Settings-Tile, App-Shortcuts, Share-Target, Export (JSON/Markdown) |

## Struktur

```
app/src/main/java/com/keeplocal/android/
├── data/        Retrofit, Room, DataStore, Repositories, Sync-Queue
├── domain/      UseCases und Modelle
├── ui/          Screens (Notes, Editor, Trash, Settings, Login, OAuth, …), Theme, Motion
├── util/        ColorContrast, SearchHighlight, Export, Logger, …
└── widget/      Glance PinnedNotesWidget
app/schemas/     Room-Schemata (Migration-Grundlage)
app/src/test/    180 Unit-Tests (Stand v1.7.0)
```

## Hinweise

- `local.properties` (SDK-Pfad) wird lokal erzeugt und nicht eingecheckt.
- Der gradle-Wrapper (8.x) liegt bei; `./gradlew` braucht kein installiertes Gradle.
- Farb-/Kontrast-Regeln sind in `app/src/test/…/util/ColorContrastTest.kt`
  festgenagelt — bei Paletten-Änderungen laufen die Tests mit.
