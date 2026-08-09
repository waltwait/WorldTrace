@AGENTS.md

# WorldTrace

A fog-of-war map of where you have actually been. Walking uncovers the map; the
uncovered area is the record. Android only so far.

**The one rule the product rests on: only real GPS counts.** A fix the platform
flags as mocked is refused and never becomes track. Levels, achievements, the
area readout — all of it is worthless the moment that stops being true, so it is
never traded away for convenience.

## Non-negotiables

- **TDD.** Write the failing test, watch it fail for the right reason, then
  implement. Every bug in this codebase that reached the phone was in the one
  place a test could not reach, which is the argument for keeping that surface
  small.
- **The tracker is the only writer of the track.** `src/capture/backgroundTask.ts`
  owns it. A second writer means a second gatekeeper, duplicate points, and
  segments split against each other.
- **Mocked fixes are refused per fix**, using each fix's own `mocked` flag —
  never the device-wide "allow mock locations" setting. The user runs a mock GPS
  app for other apps; refusing on the device-wide flag would block all their real
  recording forever. `refuseWhenMockAppEnabled` exists and is deliberately
  `false`.
- **Never invent location.** Rejections are stored with a reason and no
  coordinates. GPX import is deliberately absent: a file cannot prove you went
  somewhere.

## Stack

React Native 0.86.2 · Expo SDK 57 · TypeScript 6 · Hermes · New Architecture
(bridgeless) · vitest.

Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before
writing against an Expo API. The SDK moves fast and the general docs are wrong
for this version.

## Layout

```
src/fog/         z16 tiling, 128×128 bit bitmaps, painting, GeoJSON, area
src/gatekeeper/  accept or refuse a fix. Pure, stateful, zero I/O
src/store/       SQLite behind the SqlDriver port; tracker, summary, milestones
src/capture/     background location task, the sole writer
src/cloud/       Google Drive backup: auth, REST, schedule, restore verification
src/export/      GPX and database snapshots
src/progress/    levels and tiered achievements
src/places/      reverse geocoding, a few tiles per launch
src/ui/          screens, formatting, the app's own dialog
```

**The ports pattern is what keeps this testable.** `SqlDriver`
(`store/driver.ts`) is backed by expo-sqlite on device and by Node's built-in
`node:sqlite` in tests, so the real SQL runs under `npm test`. `DriveTransport`
(`cloud/drive.ts`) does the same for HTTP. When something needs a phone, push
the decisions out of it and leave behind only the part that genuinely cannot be
tested.

## Commands

```bash
npm test                 # 345 tests, ~1s
npm run typecheck
cd android && JAVA_HOME=$HOME/.jdks/jdk-17.0.20+8/Contents/Home \
  ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleRelease
```

- **JDK 17 exactly.** Android Studio bundles JDK 25; AGP supports ≤21, and JDK
  24+ restricts `System.load`, which breaks the CMake step.
- **`expo prebuild` will destroy the release signing config.** `android/` is
  gitignored and hand-edited on top of what prebuild generated, so the working
  copy on this machine is the only one — treat it as unbacked-up. If you must
  prebuild, restore the `signingConfigs` block in `android/app/build.gradle`
  afterwards; the README records it verbatim. Permissions survive, since
  `app.json` is their source of truth — but editing `app.json` alone changes
  nothing until the next prebuild, so edit the manifest directly when testing
  and mirror it back.
- **`Operation not permitted` from AAPT or hermesc is an agent-sandbox problem,
  not a project problem**, and it does not happen in a normal terminal. The
  shape of it: the first build after a source change fails writing an
  intermediate that already exists (`R.txt`, `index.android.bundle.hbc`); an
  immediately repeated, identical build succeeds. Killing the Gradle daemon
  does *not* prevent it, so it is not daemon state. Just run the build again,
  and verify the APK afterwards rather than trusting the exit code.

## Signing

`credentials/` holds the release keystore and its password. Gitignored, and kept
outside `android/` so prebuild cannot delete it. **Losing it means never
updating an installed build again** — only uninstall and reinstall, which takes
the database and every metre of cleared fog with it. The build fails loudly
rather than falling back to a debug signature.

SHA-1 `85:55:5F:AB:50:8A:47:DF:77:BE:D0:F5:A0:C1:BE:C0:6B:1D:5C:F4`, also
registered as the Android OAuth client. See `docs/google-drive-setup.md`.

## Verifying a change actually shipped

Release builds are not debuggable, so `adb run-as` cannot read the database. The
APK is the only thing worth trusting:

```bash
unzip -p app-release.apk assets/index.android.bundle | grep -a 'someNewIdentifier'
adb shell dumpsys package com.worldtrace.app | grep lastUpdateTime
```

Grep for **ASCII** identifiers. Hermes stores non-ASCII string literals as
UTF-16, so grepping for Chinese UI text finds nothing even when it is present —
that has already caused one false alarm. And check `lastUpdateTime` against the
APK's mtime: a build that was never installed has already cost one wasted round
of testing.

## Bugs that reached the phone, and what they taught

Each of these was silent. None crashed; recording simply stopped, or data was
quietly wrong.

- **`last_insert_rowid()` is per connection, not per statement.** Reading a new
  segment's id back that way returned whatever else had just been inserted, and
  the next point then referenced a segment that did not exist →
  `FOREIGN KEY constraint failed`. Take the id from the insert's own
  `lastInsertRowId`.
- **The background task can run twice at once.** Two runs share one tracker and
  one connection and interleave at every `await`, scrambling the gatekeeper
  until it read time as running backwards and refused good fixes. `record()` is
  serialised through a queue.
- **A SQLite database is four files.** Replacing `worldtrace.db` while leaving
  `-wal` behind made SQLite refuse every write ("attempt to write a readonly
  database") until the app was restarted. Copying only the `.db` also produces
  an incomplete backup — checkpoint with `PRAGMA wal_checkpoint(TRUNCATE)`
  first.
- **Two connections exist**, one for the screens and one for the background
  task. Both must be closed before the database file is replaced.
- **`File.copy()` returns a promise.** Unawaited, a size read afterwards
  reported 0, and a restore's rescue copy raced the delete that followed it.
- **The OS tears the background JS context down between batches.** A fresh
  tracker per batch meant one-point segments, zero distance, and the movement
  checks never running at all. `tracker.hydrate()` recovers state from the
  database.
- **`RECEIVE_BOOT_COMPLETED` is required** by expo-task-manager's persisted
  jobs, or the first fix crashes the app.
- **MapLibre RN v11 defaults Android to GLSurfaceView**, which renders the map
  mirrored on this device. Use `androidView="texture"`.
- **`src/app/` collides with Expo Router's convention.** Hence `src/ui/`.
- **The adaptive icon's monochrome layer is a mask.** Android throws its colours
  away and uses only its alpha, filled with the wallpaper's theme colour. A
  shaded globe there has an opaque disc, so themed launchers drew a solid black
  circle. The ink has to be in the alpha channel — graticule and limb only.
  `tools/make-icon.mjs` regenerates every size; `assets/` alone reaches nothing,
  since only prebuild copies it into `res/`.

## Conventions

- Comments explain *why*, especially where the obvious approach is wrong. Most
  of the comments in `store/` and `cloud/` are load-bearing.
- Units: kilometres and square kilometres everywhere, never switching scale
  mid-readout. The Earth share reads as a Chinese denominator (「88 億分之一」),
  never scientific notation.
- UI text is Traditional Chinese. The app draws its own dialogs
  (`ui/dialog.ts` + `ui/DialogHost.tsx`); do not use `Alert.alert`.
- Area always comes from the fog bitmaps, never from the points — the map and
  the number must agree.
- The map stays north-up (`trackUserLocation="default"`). A rotating fog map is
  much harder to read.

## Known gaps

- iOS has never been built or run.
- Background recording still has to survive Android power management. There is
  no in-app guidance for it — it was built and then removed at the user's
  request. If fog stops opening on long walks, check battery optimisation and
  Samsung's sleeping-apps list first.
- Achievement unlock timestamps are not persisted; achievements are recomputed
  on every read.
- The timeline has no "newly opened area" per day — bitmaps carry no per-day
  provenance.
- No permission-denied guidance screen, no disk-space check.
- Published at https://github.com/waltwait/WorldTrace. `android/`, `docs/`,
  `credentials/` and `.env.local` are deliberately not in it, so a clone is not
  a complete backup of this machine.
