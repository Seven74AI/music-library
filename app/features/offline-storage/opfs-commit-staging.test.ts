/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { offlineAudioStagingTrackId } from "./offline-audio-path.ts";
import { commitStagingOpfsFile } from "./opfs-commit-staging.ts";

class FakeFileHandle {
  name: string;
  readonly content: Uint8Array;
  readonly dir: FakeAudioDir;
  move: (destinationDirectory: FakeAudioDir, newName: string) => Promise<void>;

  constructor(dir: FakeAudioDir, name: string, content: Uint8Array) {
    this.dir = dir;
    this.name = name;
    this.content = content;
    // WebKit-shaped: only the two-arg (directory, name) overload exists, and
    // WebIDL throws when it is called with fewer arguments.
    this.move = async (...args: unknown[]) => {
      const [destinationDirectory, newName] = args;
      if (args.length < 2 || !(destinationDirectory instanceof FakeAudioDir)) {
        throw new TypeError("Not enough arguments");
      }
      if (typeof newName !== "string") {
        throw new TypeError("Not enough arguments");
      }
      if (this.dir.moveShouldFail) {
        throw new Error("move failed");
      }
      this.dir.files.delete(this.name);
      this.name = newName;
      this.dir.files.set(newName, this);
    };
  }
}

class FakeAudioDir {
  files = new Map<string, FakeFileHandle>();
  moveShouldFail = false;

  async getFileHandle(name: string) {
    const file = this.files.get(name);
    if (!file) {
      throw new DOMException("Not found", "NotFoundError");
    }
    return file;
  }
}

function stubOpfs(audioDir: FakeAudioDir) {
  vi.stubGlobal("navigator", {
    storage: {
      getDirectory: async () => ({
        getDirectoryHandle: async () => audioDir,
      }),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("commitStagingOpfsFile", () => {
  test("replaces live audio by moving the staging file", async () => {
    const audioDir = new FakeAudioDir();
    const trackId = "track-live";
    const stagingTrackId = offlineAudioStagingTrackId(trackId);
    audioDir.files.set(
      `${trackId}.mp3`,
      new FakeFileHandle(audioDir, `${trackId}.mp3`, new Uint8Array([1, 2, 3])),
    );
    audioDir.files.set(
      `${stagingTrackId}.mp3`,
      new FakeFileHandle(audioDir, `${stagingTrackId}.mp3`, new Uint8Array([9, 8, 7])),
    );
    stubOpfs(audioDir);

    await commitStagingOpfsFile(stagingTrackId, trackId, "mp3");

    expect(audioDir.files.has(`${stagingTrackId}.mp3`)).toBe(false);
    const live = audioDir.files.get(`${trackId}.mp3`);
    expect(live?.content).toEqual(new Uint8Array([9, 8, 7]));
  });

  test("calls move with (directory, name) so WebKit does not throw", async () => {
    const audioDir = new FakeAudioDir();
    const trackId = "track-webkit";
    const stagingTrackId = offlineAudioStagingTrackId(trackId);
    const handle = new FakeFileHandle(
      audioDir,
      `${stagingTrackId}.mp3`,
      new Uint8Array([5, 5, 5]),
    );
    const moveSpy = vi.spyOn(handle, "move");
    audioDir.files.set(`${stagingTrackId}.mp3`, handle);
    stubOpfs(audioDir);

    await commitStagingOpfsFile(stagingTrackId, trackId, "mp3");

    expect(moveSpy).toHaveBeenCalledWith(audioDir, `${trackId}.mp3`);
    expect(audioDir.files.get(`${trackId}.mp3`)?.content).toEqual(new Uint8Array([5, 5, 5]));
  });

  test("leaves live bytes intact when commit move fails", async () => {
    const audioDir = new FakeAudioDir();
    const trackId = "track-safe";
    const stagingTrackId = offlineAudioStagingTrackId(trackId);
    const liveBytes = new Uint8Array([11, 22, 33]);
    audioDir.files.set(`${trackId}.mp3`, new FakeFileHandle(audioDir, `${trackId}.mp3`, liveBytes));
    audioDir.files.set(
      `${stagingTrackId}.mp3`,
      new FakeFileHandle(audioDir, `${stagingTrackId}.mp3`, new Uint8Array([44, 55, 66])),
    );
    audioDir.moveShouldFail = true;
    stubOpfs(audioDir);

    await expect(commitStagingOpfsFile(stagingTrackId, trackId, "mp3")).rejects.toThrow(
      /move failed/,
    );

    expect(audioDir.files.get(`${trackId}.mp3`)?.content).toEqual(liveBytes);
    expect(audioDir.files.has(`${stagingTrackId}.mp3`)).toBe(true);
  });
});
