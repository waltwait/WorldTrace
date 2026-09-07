#!/usr/bin/env bash
#
# Build, verify and (optionally) publish a release APK.
#
# Signing material lives in credentials/ on this machine and nowhere else, so
# this cannot run on CI — that is the point. CI checks the JavaScript; this
# produces the thing people install.
#
#   tools/release.sh                       build and verify only
#   tools/release.sh --expect pageSlide     also prove an identifier reached the bundle
#   tools/release.sh --install              install over the app on the attached device
#   tools/release.sh --publish v1.0.1       create the GitHub release and upload the APK
#
set -euo pipefail

cd "$(dirname "$0")/.."

JAVA_HOME_DIR="$HOME/.jdks/jdk-17.0.20+8/Contents/Home"
ANDROID_SDK="/opt/homebrew/share/android-commandlinetools"
ADB="$ANDROID_SDK/platform-tools/adb"
APK="android/app/build/outputs/apk/release/app-release.apk"

expect=""
install=false
tag=""

while [ $# -gt 0 ]; do
  case "$1" in
    --expect)  expect="${2:?--expect needs an identifier}"; shift 2 ;;
    --install) install=true; shift ;;
    --publish) tag="${2:?--publish needs a tag, e.g. v1.0.1}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

# --- state ------------------------------------------------------------------
# Publishing pins a tag to a commit, so refuse to do it from a tree that does
# not match what anyone else can fetch.
if [ -n "$tag" ]; then
  say "checking the tree is publishable"
  [ -z "$(git status --porcelain)" ] || { echo "working tree is dirty" >&2; exit 1; }
  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "not on main" >&2; exit 1; }
  git fetch --quiet origin main
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || {
    echo "HEAD and origin/main differ — push first" >&2; exit 1
  }
fi

# --- verify -----------------------------------------------------------------
say "typecheck"
npm run typecheck

say "tests"
npm test

# --- build ------------------------------------------------------------------
# The first build after a source change sometimes dies writing an intermediate
# that already exists (R.txt, index.android.bundle.hbc). It is an agent-sandbox
# problem, not a project one, and an identical repeat succeeds — so repeat once
# rather than making a person do it.
say "assembling release"
build() {
  ( cd android && JAVA_HOME="$JAVA_HOME_DIR" ANDROID_HOME="$ANDROID_SDK" ./gradlew assembleRelease )
}
build || { echo "first build failed — retrying once"; build; }

[ -f "$APK" ] || { echo "no APK at $APK" >&2; exit 1; }

# --- verify the artifact, not the exit code ---------------------------------
say "APK"
version_code=$(grep -E '^\s*versionCode' android/app/build.gradle | head -1 | tr -dc '0-9')
printf 'path         %s\n' "$APK"
printf 'size         %s\n' "$(du -h "$APK" | cut -f1)"
printf 'sha256       %s\n' "$(shasum -a 256 "$APK" | cut -d' ' -f1)"
printf 'versionCode  %s\n' "$version_code"

if [ -n "$expect" ]; then
  # Grep for ASCII only: Hermes stores non-ASCII literals as UTF-16, so looking
  # for Chinese UI text finds nothing even when it is there.
  # grep -c rather than -q: -q exits on the first match, and the closed pipe
  # makes unzip fail, which under `set -o pipefail` fails the whole script.
  if unzip -p "$APK" assets/index.android.bundle | grep -ac "$expect" >/dev/null; then
    printf 'contains     %s ✓\n' "$expect"
  else
    echo "'$expect' is not in the bundle — the build did not include your change" >&2
    exit 1
  fi
fi

# Anyone who installed an earlier release can only upgrade to a higher
# versionCode. Equal means their only route is uninstall, which takes the
# database and every metre of cleared fog with it.
if [ -n "$tag" ]; then
  printf '\nversionCode for this release is %s. Every published release needs a\n' "$version_code"
  printf 'higher one than the last, or nobody can upgrade to it.\n'
  printf 'Continue? [y/N] '
  read -r reply
  [ "$reply" = y ] || { echo "stopped"; exit 1; }
fi

# --- install ----------------------------------------------------------------
if [ "$install" = true ]; then
  say "installing"
  "$ADB" install -r "$APK"
  "$ADB" shell dumpsys package com.worldtrace.app | grep lastUpdateTime
fi

# --- publish ----------------------------------------------------------------
if [ -n "$tag" ]; then
  say "publishing $tag"
  asset="$(mktemp -d)/WorldTrace-$tag.apk"
  cp "$APK" "$asset"

  if gh auth status >/dev/null 2>&1; then
    gh release create "$tag" "$asset" \
      --title "WorldTrace $tag" \
      --notes "Android release build, signed with the project's release key. Installs as an update over any earlier build signed with the same key."
  else
    # Printing the command beats pretending this worked.
    cat <<EOF

gh is not logged in, so the release was not created. Run:

  gh auth login
  gh release create $tag "$asset" --title "WorldTrace $tag"

The APK is at $asset
EOF
    exit 1
  fi
fi

say "done"
