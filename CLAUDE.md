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
src/flights/     flights, kept apart from the track: the add form (flightForm),
                 airport-local time (zonedTime), reading a ticket on the phone
                 (readTicket, ticketFacts), lookup and status polling
                 (flightStatusApi), great-circle arcs, passport stats
src/settings/    API keys: entered on the settings page, kept in the Keystore
src/ui/          screens, themes, formatting, the app's own dialog
```

Four pages under a floating toolbar, 總覽, 足跡, 航班, 設定, with ＋ for a new
flight on any of them (`ui/Toolbar.tsx`). They sit in a horizontal `ScrollView` in
`App.tsx`, so a swipe follows the finger on the UI thread even while the fog holds
the JS thread; `ui/pager.ts` says which page a position is. What opens over them:
探索 from the numbers on 總覽, 飛行護照 from its card on 總覽, a flight's detail, and
the add sheet. Backup, restore, export and redrawing the fog are all
in 設定.

**The ports pattern is what keeps this testable.** `SqlDriver`
(`store/driver.ts`) is backed by expo-sqlite on device and by Node's built-in
`node:sqlite` in tests, so the real SQL runs under `npm test`. `DriveTransport`
(`cloud/drive.ts`) does the same for HTTP. When something needs a phone, push
the decisions out of it and leave behind only the part that genuinely cannot be
tested.

## Commands

```bash
npm test                 # ~960 tests, ~3s
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
- **A shared object nothing refers to can be collected in the middle of its own
  work.** `ImageManipulator.manipulate(uri).rotate(d).renderAsync()` leaves JS with
  no reference to the context, and on Android releasing a context cancels its
  render: "Context.renderAsync has been rejected", whenever a collection fell during
  the render. It passed every test on the phone until more JS was running. Keep the
  reference and release it afterwards (`turnedCopy` in `flights/readTicket.ts`), and
  the same goes for anything else from `expo-modules-core`'s `SharedObject`.
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
- A flight carries only what was typed or read off a ticket — the same rule as
  the track. `flights/flightForm.ts` refuses to save without a date and time,
  and leaves gate, terminal, seat and cabin empty when nobody gave them; the
  first version of the sheet made all of those up. Ticket times are local to
  their airport (`flights/zonedTime.ts`), never the phone's zone.
- A clock never finishes a flight. Only the status API saying Arrived, the user
  marking it, or typing in a trip already over does: `syncFlightStatus` hands
  back the same flight when nothing comes back, and polling stops a day past the
  scheduled arrival. It used to work a status out from the time, which landed
  cancelled and missed flights and stamped them into the passport.
- A ticket gives three things and no more: flight number, date and time, seat
  (`flights/ticketFacts.ts`). The status API supplies the rest. Text recognition
  runs on the phone, and the picture and any turned copy are deleted once read
  (`flights/readTicket.ts`): nothing is uploaded, and the booking code, the name
  and the barcode, which holds both, are never read or kept. A booking code is
  not stored or shown anywhere.
- Flights are stored by where each thing came from, in three tables
  (`store/flightSchema.ts`): `flights` what the user confirmed, `flight_schedule`
  the timetable with a `source` of `api` or `user`, `flight_status` what changes.
  `store/flights.ts` joins them, so nothing else knows there are three. A flight
  is looked up by number and date however it was entered; the airports, times and
  zones are typed by hand only when nothing was found.
- The API answers for dates within a year either way, on every plan, and refuses
  the rest with a 400. An older flight is looked up on the same weekday near the same
  date this year, then that date, then the last such weekday (`flights/flightLookup.ts`),
  and moved onto its own date, for the route, country and distance a passport needs.
  Its times are another day's, so its `source` is `nearby`, the detail page says so,
  and the form says so before it is saved. The one exception to a flight carrying only
  what was typed or read, and the user's call: a number may have changed route since.
- There is no table of airports. City, country, position and zone come from the
  status API and are kept on the flight, so a flight typed by hand has none of
  them: no arc, no distance, no stamp. Cities read in English, as the API gives
  them, like 「Taipei (TPE)」. Country names are in `flights/countries.ts`, made by
  `tools/make-countries.mjs`.
- The flight tables migrate on the screens' connection only (`migrate`); the
  background task runs `migrateTrack`. Two connections changing them at once
  could fail, and on that one it would stop recording without a word.
- ML Kit reads the zero of a padded flight number as the letter O (`BRO117/21JUN`),
  on every turn of the picture. Vision on a Mac reads it correctly, so a ticket is not
  tested until it has been through the phone. The O is only forgiven with a date
  behind it, or a booking code could pass for a flight.
- Tickets often print no year. `flights/ticketYear.ts` works it out, from a
  printed weekday if there is one; without one the form says it is a guess.
- The flight API key is entered on 設定 and kept in the Android Keystore
  (`settings/`), never in the database, a backup or the bundle: `EXPO_PUBLIC_`
  values are written into the APK in plain text and releases are public. The
  Google web client ID stays in `.env.local`: it is public, and tied to the
  build's signature.
- Every hook runs before any `return`. No component can be mounted under
  vitest, so `ui/hookOrder.test.ts` reads the source of every component
  instead; a hook after an early return took the whole app down on the first
  tapped flight card, with every test green.
- The map stays north-up (`trackUserLocation="default"`). A rotating fog map is
  much harder to read.
- There is one map, `ui/FogMap.tsx`, and it lives in the tile on 總覽. It is always
  the size of the screen and the tile shows the middle of it (`ui/mapCrop.ts`), so
  opening it uncovers what is already drawn. Growing the map instead rebuilt its
  surface and, with a wider view than the fog served, redrew the fog too. Opening
  changes the style of the view around it rather than moving it: a new view would
  tear down MapLibre's native map and start the fog again. Anything the tile shows
  over the map belongs to `ui/OverviewScreen.tsx`, since `FogMap`'s own overlays are
  placed on the whole screen and would sit outside the tile. Following the user
  makes the map draw every frame, so it stops while nobody can see the map (`active`). Reviewing a day and viewing a flight both go through that same map. For
  the same reason 總覽 does not scroll.
- Colours come from the theme, never from a literal: `ui/themes.ts` holds them and
  their contrast is pinned in `themes.test.ts`. A style sheet is
  `const make = (t: Theme) => StyleSheet.create({...})` at module level, read with
  `useStyles(make)`. The choice is kept in `theme.json` beside the database, for
  the same reason as the export folder. No dark mode yet.
- Text is set in Noto Sans TC, and figures in Sora: distances, times, airport codes,
  as the design has them. React Native has no default font, a `fontWeight` picks no
  file on Android, and Sora has no Chinese, so every screen takes `Text` and
  `TextInput` from `ui/Text.tsx`, which works all of that out (`ui/fonts.ts`); a test
  reads the source for any screen that does not. Animated text cannot go through it
  and calls `textStyle` itself. A style in Sora names `FONT` and sets no `fontWeight`.
  An input holds one font, so a field typed in Chinese says `chinese`. This phone is
  set to a handwriting face, which is what anything missed comes out in. The files
  are in `assets/fonts/` and listed in `app.json`, but prebuild is what copies them,
  so a new one also has to go into `android/app/src/main/assets/fonts/` by hand.
  Nothing crashes if it does not: the phone's font is drawn instead, which is why
  `tools/release.sh` checks the APK.
- The Noto files are edited. `tools/fonts/center_noto_line_box.py` moves the line box so Chinese sits in
  the middle of it: as shipped it sits 0.5 to 1 dp low in every button and pill.
  `tools/fonts/strip_emoji_presentation.py` takes out the characters that should come
  in colour from the phone: Noto's black-and-white 🆕 would win. Replacing a file
  undoes both without a word, so run both again; `ui/themes.test.ts` reads the files
  and goes red if not. Then copy them into `android/` as above.
- 飛行護照 (`ui/PassportScreen.tsx`) counts flights flown and nothing else, the
  same as the fog, and everything it says comes from `flights/flightStats.ts`.
  Years go by the date on the ticket, not UTC. It stays about flying: 探索 is
  about walking.
- Dates are chosen from the app's own calendar (`ui/DateField.tsx`,
  `ui/calendar.ts`), not typed and not the system's picker, so it takes the theme.
- Tickets are read from pictures only. There is no pasting of text: the user took
  it out.
- Exports can be shared or saved to a folder (`export/saveToFolder.ts`). Android
  will not let an app write to Downloads itself, only to a folder the user picked
  inside it, once, through the system picker; the app keeps the grant. The choice
  is kept in `export-settings.json` beside the database, not in it: a restore
  replaces the database, and a folder grant belongs to this install.
- No text that says what a control already shows. The user has asked twice for
  explanations to come out: no subtitles, hints, "tap here" lines or empty-state
  instructions. Labels, one-line errors, the confirmation before anything
  destructive, and "no records yet" stay.
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
- The press, busy and confirmation animations on 設定 and 足跡 have passed their
  tests and bundle cleanly but have not been watched running on the phone.
- Flight tickets and boarding passes are kept in `flight-docs/` beside the
  database, not in it (`store/flightDocs.ts`), so a Drive backup or a snapshot
  carries the rows but not the files: after a restore onto another phone a
  document is listed and will not open. Documents attached before they were
  copied out of the picker's cache may already be gone.
- Ticket reading has been tried on the two sample pictures with Apple Vision on
  a Mac, not with ML Kit on the phone, and the flight lookup has only been seen
  working once, for JX871: the route, time and arc were right.
  ML Kit here reads Latin script only, so 「12月31日」 may not be read. The fields the code reads all appear in
  the published OpenAPI (doc.aerodatabox.com), which says what may come back, not
  what does for a given airport.
- A status poll that gets no answer is not stamped as synced, so a flight the API
  has nothing on is asked about again on every launch. The free plan is 400 units
  a month and this endpoint costs 2, so 200 calls: enough for normal use, but a
  mistyped flight number would quietly spend it.
- Every fog change still reloads all tile BLOBs (`loadAllTiles`) and recomputes
  the area; the viewport work only bounds tracing and rendering.
- Published at https://github.com/waltwait/WorldTrace. `android/`, `docs/`,
  `credentials/` and `.env.local` are deliberately not in it, so a clone is not
  a complete backup of this machine.
