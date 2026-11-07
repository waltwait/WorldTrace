import { describe, expect, test, vi } from 'vitest';
import { pickTicketImageUri } from './pickTicketImage';

describe('pickTicketImageUri', () => {
  test('returns the image library URI when the photo picker succeeds', async () => {
    const pickFromLibrary = vi.fn().mockResolvedValue('file:///cache/photo.jpg');
    const pickFromDocuments = vi.fn();

    const uri = await pickTicketImageUri({ pickFromLibrary, pickFromDocuments });

    expect(uri).toBe('file:///cache/photo.jpg');
    expect(pickFromDocuments).not.toHaveBeenCalled();
  });

  test('returns null when the user cancels the photo picker', async () => {
    const pickFromLibrary = vi.fn().mockResolvedValue(null);
    const pickFromDocuments = vi.fn();

    const uri = await pickTicketImageUri({ pickFromLibrary, pickFromDocuments });

    expect(uri).toBeNull();
    expect(pickFromDocuments).not.toHaveBeenCalled();
  });

  test('falls back to the document picker when Expo ImagePicker launcher is unregistered', async () => {
    const pickFromLibrary = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "Call to function 'ExponentImagePicker.launchImageLibraryAsync' has been rejected.\n→ Caused by: java.lang.IllegalStateException: Attempting to launch an unregistered ActivityResultLauncher",
        ),
      );
    const pickFromDocuments = vi.fn().mockResolvedValue('file:///cache/DocumentPicker/pass.png');

    const uri = await pickTicketImageUri({ pickFromLibrary, pickFromDocuments });

    expect(uri).toBe('file:///cache/DocumentPicker/pass.png');
    expect(pickFromDocuments).toHaveBeenCalledTimes(1);
  });

  test('rethrows unrelated errors from the photo picker', async () => {
    const pickFromLibrary = vi.fn().mockRejectedValue(new Error('Disk full'));
    const pickFromDocuments = vi.fn();

    await expect(pickTicketImageUri({ pickFromLibrary, pickFromDocuments })).rejects.toThrow(
      'Disk full',
    );
    expect(pickFromDocuments).not.toHaveBeenCalled();
  });
});
