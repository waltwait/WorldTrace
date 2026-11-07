/**
 * Picking a ticket image from the phone, with a safe fallback when Expo's
 * ActivityResultLauncher contract was unregistered across an Activity swap.
 */

export interface TicketImagePickPorts {
  pickFromLibrary: () => Promise<string | null>;
  pickFromDocuments: () => Promise<string | null>;
}

function isUnregisteredLauncherError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message}\n${String(error.cause ?? '')}` : String(error);
  return text.includes('ActivityResultLauncher');
}

export async function pickTicketImageUri(ports: TicketImagePickPorts): Promise<string | null> {
  try {
    return await ports.pickFromLibrary();
  } catch (error) {
    if (isUnregisteredLauncherError(error)) {
      return ports.pickFromDocuments();
    }
    throw error;
  }
}
