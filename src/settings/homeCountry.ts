/**
 * The country flights leave from. Everyone starts from home, so it gets no stamp and
 * does not count as somewhere visited. Kept beside the database rather than in it,
 * like the theme: a restore replaces the database, and this belongs to the user.
 */

const COUNTRY_CODE = /^[A-Z]{2}$/;

export function serializeHomeCountry(code: string | null): string {
  return JSON.stringify({ code });
}

export function parseHomeCountry(text: string): string | null {
  try {
    const code: unknown = JSON.parse(text)?.code;
    return typeof code === 'string' && COUNTRY_CODE.test(code) ? code : null;
  } catch {
    return null;
  }
}
