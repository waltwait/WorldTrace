/**
 * Google sign-in, on the device.
 *
 * A thin shell over the native SDK, kept free of any backup logic so that the
 * parts worth testing are not stuck behind Play Services. Everything here needs
 * a real phone, so nothing here is tested — which is exactly why it does as
 * little as possible.
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { DRIVE_APPDATA_SCOPE, GOOGLE_WEB_CLIENT_ID, isGoogleConfigured } from './googleConfig';

export interface Account {
  email: string;
  name: string | null;
}

let configured = false;

function configure(): void {
  if (configured) return;

  if (!isGoogleConfigured()) {
    throw new Error('這個版本沒有內建 Google 用戶端 ID，無法登入');
  }

  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: [DRIVE_APPDATA_SCOPE],
    // No offline access: that exists to hand a refresh token to your own
    // server, and there is no server here. The native SDK refreshes the access
    // token on the device instead.
    offlineAccess: false,
  });

  configured = true;
}

/** Sign in with a picker. Null if the user backed out. */
export async function signIn(): Promise<Account | null> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (response.type !== 'success') return null;

  return toAccount(response.data.user);
}

/**
 * The silent sign-in currently in flight, if any.
 *
 * The native module keeps a single slot for the promise it has to settle, so a
 * second overlapping call leaves the first with nothing to resolve — it logs
 * "cannot reject promise because it's null" and one caller hangs. Two callers
 * do overlap in practice: the automatic backup and the backup screen both ask
 * on startup. They share one call instead.
 */
let inFlight: Promise<Account | null> | null = null;

/**
 * Pick up an existing session without showing anything.
 *
 * Null when there is nothing saved, which includes the case where the refresh
 * token has expired — Google expires those after seven days while the OAuth
 * consent screen is still in testing mode, so this returning null periodically
 * is expected rather than a fault.
 */
export async function restoreSession(): Promise<Account | null> {
  if (!isGoogleConfigured()) return null;
  configure();

  inFlight ??= (async () => {
    try {
      const response = await GoogleSignin.signInSilently();
      return response.type === 'success' ? toAccount(response.data.user) : null;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function signOut(): Promise<void> {
  if (!isGoogleConfigured()) return;
  configure();
  await GoogleSignin.signOut();
}

/** A bearer token for the Drive API. Throws if nobody is signed in. */
export async function accessToken(): Promise<string> {
  configure();
  const tokens = await GoogleSignin.getTokens();

  return tokens.accessToken;
}

function toAccount(user: { email: string; name: string | null }): Account {
  return { email: user.email, name: user.name };
}
