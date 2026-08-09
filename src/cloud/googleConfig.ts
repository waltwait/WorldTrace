/**
 * The OAuth client this app signs in with.
 *
 * Comes from Google Cloud Console. It has to be the **Web** client ID even
 * though this is an Android app: Android OAuth clients issue no secret and
 * cannot be the subject of a token exchange, so Google's own libraries use the
 * Android client to prove the app's identity (package name plus signing
 * certificate) and the Web client as the audience for the tokens that come
 * back.
 *
 * Not hardcoded, and not because it is a secret — a client ID is public by
 * design, readable out of any APK, and Google's security here rests on the
 * signing certificate rather than on this string. It is out of the source
 * because it is *this build's* identity: it is bound to one package name and
 * one certificate, so a clone that inherited it would only ever be refused.
 * Anyone building their own has to register their own, and an empty value is
 * the honest starting state.
 *
 * Put it in `.env.local` (gitignored) as:
 *
 *     EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
 *
 * Metro inlines `EXPO_PUBLIC_*` at bundle time, so this is a build-time
 * constant on device, not a lookup — which also means changing it needs a
 * rebuild, not just a reload.
 *
 * A client *secret* would not be safe here, and is not needed: the flow is
 * PKCE.
 */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';

/**
 * The only scope requested.
 *
 * `drive.appdata` reaches a private per-app folder that is hidden from the
 * user's Drive listing and invisible to every other app. WorldTrace cannot read
 * anything else in the account — not a permission it declines to use, one it
 * was never granted.
 */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Whether the build has been given a client ID at all. */
export function isGoogleConfigured(): boolean {
  return GOOGLE_WEB_CLIENT_ID.length > 0;
}
