import { beforeEach, describe, expect, test } from 'vitest';
import { BACKUP_FILE_NAME, createDrive, type DriveTransport } from './drive';

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

/**
 * A stand-in for Google's servers.
 *
 * Records everything asked of it so the tests can assert on the actual HTTP
 * shape — Drive is unforgiving about which endpoint takes metadata and which
 * takes bytes, and that distinction is the whole point of this module.
 */
function fakeTransport() {
  const requests: RecordedRequest[] = [];
  const sends: RecordedRequest[] = [];
  const receives: { url: string; uri: string }[] = [];
  let listResponse: unknown = { files: [] };
  let createResponse: unknown = { id: 'new-file' };

  const transport: DriveTransport = {
    async request(init) {
      requests.push(init);
      return init.method === 'GET' ? listResponse : createResponse;
    },
    async sendFile(init) {
      sends.push({ method: init.method, url: init.url });
    },
    async receiveFile(init) {
      receives.push(init);
    },
  };

  return {
    transport,
    requests,
    sends,
    receives,
    setFiles(files: unknown[]) {
      listResponse = { files };
    },
    setCreated(id: string) {
      createResponse = { id };
    },
  };
}

let fake: ReturnType<typeof fakeTransport>;

beforeEach(() => {
  fake = fakeTransport();
});

describe('findBackup', () => {
  test('looks only inside the hidden app folder', async () => {
    await createDrive(fake.transport).findBackup();

    const [request] = fake.requests;
    expect(request.method).toBe('GET');
    expect(request.url).toContain('spaces=appDataFolder');
  });

  test('is null when nothing has ever been backed up', async () => {
    expect(await createDrive(fake.transport).findBackup()).toBeNull();
  });

  test('returns the backup when one exists', async () => {
    fake.setFiles([
      { id: 'abc', name: BACKUP_FILE_NAME, size: '4096', modifiedTime: '2026-08-02T10:00:00Z' },
    ]);

    const found = await createDrive(fake.transport).findBackup();

    expect(found).toEqual({
      id: 'abc',
      name: BACKUP_FILE_NAME,
      bytes: 4096,
      modifiedAt: Date.parse('2026-08-02T10:00:00Z'),
    });
  });

  test('ignores anything in the folder that is not our backup', async () => {
    fake.setFiles([{ id: 'x', name: 'something-else.txt', size: '10', modifiedTime: '2026-08-02T10:00:00Z' }]);

    expect(await createDrive(fake.transport).findBackup()).toBeNull();
  });

  test('survives a file entry with no size reported', async () => {
    fake.setFiles([{ id: 'abc', name: BACKUP_FILE_NAME, modifiedTime: '2026-08-02T10:00:00Z' }]);

    expect((await createDrive(fake.transport).findBackup())?.bytes).toBe(0);
  });
});

describe('upload', () => {
  test('creates the file in the app folder the first time', async () => {
    fake.setCreated('created-id');

    await createDrive(fake.transport).upload('file:///tmp/db.sqlite');

    const create = fake.requests.find((request) => request.method === 'POST');
    expect(create?.url).toBe('https://www.googleapis.com/drive/v3/files');
    expect(create?.body).toEqual({ name: BACKUP_FILE_NAME, parents: ['appDataFolder'] });
  });

  test('sends the bytes to the upload endpoint, not the metadata one', async () => {
    fake.setCreated('created-id');

    await createDrive(fake.transport).upload('file:///tmp/db.sqlite');

    expect(fake.sends).toHaveLength(1);
    expect(fake.sends[0].url).toContain('/upload/drive/v3/files/created-id');
    expect(fake.sends[0].url).toContain('uploadType=media');
    expect(fake.sends[0].method).toBe('PATCH');
  });

  test('overwrites the existing backup instead of piling up copies', async () => {
    // Drive happily keeps several files with the same name. Left alone this
    // would grow without limit and quietly eat the user's Drive quota.
    fake.setFiles([
      { id: 'existing', name: BACKUP_FILE_NAME, size: '4096', modifiedTime: '2026-08-02T10:00:00Z' },
    ]);

    await createDrive(fake.transport).upload('file:///tmp/db.sqlite');

    expect(fake.requests.some((request) => request.method === 'POST')).toBe(false);
    expect(fake.sends[0].url).toContain('/files/existing');
  });

  test('reports the file it wrote to, so the id can be remembered', async () => {
    fake.setCreated('created-id');

    expect(await createDrive(fake.transport).upload('file:///tmp/db.sqlite')).toBe('created-id');
  });
});

describe('download', () => {
  test('asks for the bytes rather than the metadata', async () => {
    await createDrive(fake.transport).download('abc', 'file:///tmp/restore.sqlite');

    expect(fake.receives[0].url).toBe('https://www.googleapis.com/drive/v3/files/abc?alt=media');
    expect(fake.receives[0].uri).toBe('file:///tmp/restore.sqlite');
  });
});

describe('deleteBackup', () => {
  test('removes the file so signing out can leave nothing behind', async () => {
    await createDrive(fake.transport).deleteBackup('abc');

    const request = fake.requests[0];
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe('https://www.googleapis.com/drive/v3/files/abc');
  });
});
