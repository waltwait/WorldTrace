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
src/fog/         z16 tiling, 128×128 bit bitmaps, painting, area, and the fog
                 geometry: contour tracing (geojson), per-viewport build
                 (fogGeometry, view), quadtree cut into polygons (fogPartition)
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
npm test                 # ~480 tests, ~3s
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
- **A closed route cleared the ground it enclosed.** The tracer kept only the
  counter-clockwise outlines and threw the clockwise ones away — which are the
  pockets of fog sealed inside a loop. Walk round a block and the whole block
  opened. Ring counts could never see it; `fog/testing/oracle.ts` rasterises the
  output and compares it to the bitmap cell by cell, and every geometry test that
  matters goes through it.
- **The fog is a MultiPolygon, cut into pieces, and built for the viewport.** One
  polygon over the world with every hole in it breaks twice over: the native fill
  path keeps only the 500 largest holes of a polygon and refuses more than 65 535
  vertices, and building it all blocks the JS thread for seconds. So
  `fogPartition.ts` cuts the world into a quadtree of squares down to single
  tiles (no polygon holds more than one tile's holes), `view.ts` limits full
  tracing to what the map shows plus a margin and coarsens the grid as zoom falls
  (a block clears if *any* cell in it is explored — never the other way round).
  Everything outside is **not** left as fog: it is drawn too, in blocks of at
  least 16 cells (`FAR_MIN_SCALE`), so zooming out finds the whole history already
  there. Left as fog it vanished until the redraw landed, and a fast pinch
  outruns the redraw. Tiles around the middle of the view keep full
  detail whatever the zoom (`HOT_TILES`): a fast zoom-in otherwise magnifies the
  coarse blocks into bright patches of ground that was never walked, until the
  redraw lands. The fog is redrawn mid-gesture only
  when leaving it alone would look wrong — a zoom *in* needing a finer grain, a
  drag out of what was drawn (`FogBuilder.isUrgent`) — never for a zoom out, and
  at most every 500 ms. Handing the map new fog makes it throw its tiles away and
  start again, and a map made to do that every quarter of a second never gets as
  far as drawing the tiles the new zoom needs: in a recording of a fast zoom-out
  the fog was gone from everywhere but a small box round the user, and still
  missing a second after the pinch ended. Blank is not fog. `fill-antialias` is off on the layer because
  antialiasing outlines every polygon edge, and neighbours share edges.
- **`GeoJSONSource` runs `JSON.stringify` on its `data` on every render.** Pass a
  string, made once per change (`ui/useFog.ts`).
- **`onRegionDidChange` fires on every frame in follow mode, even sitting still**
  — about 120 times a second here, measured with logcat on the phone. Putting
  each report into React state rendered the whole map screen that often.
  `ui/fogController.ts` asks the fog builder whether the fog already drawn still
  serves a report and leaves React alone if so; its tests pin that a thousand
  identical reports ask for nothing.
- **Background recording ran without its foreground service, so the system kept
  killing the process.** Android only lets an app start a foreground service while
  it is in front, and a task the OS has saved across a restart comes back in the
  background: expo-location refused the service (logcat: "Foreground location task
  cannot be started while the app is in the background!"), the process sat cached,
  and the system killed it for memory again and again (`dumpsys activity exit-info
  com.worldtrace.app`: `importance=400`, `LOW_MEMORY`). `startBackgroundRecording`
  then found the task already running and returned, so opening the app never asked
  for the service again. `capture/recordingStart.ts` registers the task on every
  launch, which restarts the service while the app is in front. After a swipe-away
  or a reboot the OS still brings the process back unprotected until the app is
  opened; the "WorldTrace 記錄中" notification is how to tell. Check with
  `adb shell dumpsys activity services com.worldtrace.app` (a `LocationTaskService`
  with `isForeground=true`) and `dumpsys notification --noredact`.
- **Place naming went by when a tile was last touched, so a trip abroad queued
  behind the ground at home.** Twelve tiles are named per launch, newest first —
  but rebuilds and redraws refresh `updated_at` for swathes of old ground at once
  (566 tiles in a day), so 91 Singapore tiles sat behind 596 tiles in Taiwan:
  fifty launches before the first foreign tile was named, and "countries: 1" after
  a three-day trip. Nothing was stuck and nothing was recorded wrong — the points
  were all there. `unresolvedTiles` now takes ground with no named tile within 64
  tiles first, then 16, then 4, one per stretch, and only then newest first.
  Found by exporting the database from the phone and counting, not from the code.
- **Two callers who arrive together both run the scan.** A cache of finished
  answers does nothing for concurrent calls; `store/sharedRead.ts` caches the
  promise instead.
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
- Exports can be shared or saved to a folder (`export/saveToFolder.ts`). Android
  will not let an app write to Downloads itself, only to a folder the user picked
  inside it, once, through the system picker; the app keeps the grant. The choice
  is kept in `export-settings.json` beside the database, not in it: a restore
  replaces the database, and a folder grant belongs to this install.
- A tapped action answers on the button that was tapped, not in a corner of the
  screen. `ui/ActionButton.tsx` shows a spinner while the work runs and then the
  result in place; what it shows when is `ui/actionState.ts`, which is tested
  with injected timers: busy only after 120 ms (a faster action would just
  flash), kept up 400 ms once shown, a confirmation held 2.2 s. A failure is
  reported by a dialog, never by the button.
- Motion is `transform` and `opacity` on the native driver, and nothing else
  (`PressScale`, `SwapText`). Redrawing the fog holds the JS thread for seconds,
  and anything driven from JS freezes mid-press while it runs. `RollingNumber`
  is the one exception — text cannot be driven natively — so it only runs for a
  change that shows in the formatted text and never counts up from zero unless
  the screen is being arrived at (`shouldCount`).

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
- A fast zoom out shows newly exposed map without fog until the native side has
  cut tiles for the new zoom — large patches mid-pinch, all fogged about 0.25 s
  after the pinch stops (screen recording, 2026-11-01). Tried, and no help:
  coarsening the far ring (the fog JSON shrinks by 0–30%; its floor is one
  polygon per explored tile, not the grain) and capping the fog source's
  `maxzoom` at 11 (the flash shows at whole-island zooms, beyond the cap). What
  would fix it by construction is a dark base map with walked ground lit on top,
  since MapLibre cannot cut holes in a layer below — but walked ground would then
  show a tinted dark map, not the real one. Native tile errors from the map are
  not surfaced anywhere — logcat shows none.
- Saving an export to a folder (`folderPort.ts`) has passed its tests but has not
  been tried on the phone: the system picker, the write into a document folder
  and whether the file keeps its name and extension are all the part a test
  cannot reach.
- The press, busy and confirmation animations on the backup page and the
  timeline have passed their tests and bundle cleanly but have not been watched
  running on the phone.
- Every fog change still reloads all tile BLOBs (`loadAllTiles`) and recomputes
  the area; the viewport work only bounds tracing and rendering.
- Published at https://github.com/waltwait/WorldTrace. `android/`, `docs/`,
  `credentials/` and `.env.local` are deliberately not in it, so a clone is not
  a complete backup of this machine.
