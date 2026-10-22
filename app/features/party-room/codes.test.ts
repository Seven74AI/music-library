import { expect, test, vi } from "vitest";
import {
  buildRoomJoinPath,
  buildRoomJoinUrl,
  generateRoomCode,
  isValidRoomCode,
  parseRoomCodeInput,
} from "./codes.ts";
import { ROOM_CODE_CHARSET, ROOM_CODE_LENGTH } from "./constants.ts";

test("generateRoomCode uses charset and fixed length", () => {
  const code = generateRoomCode();
  expect(code).toHaveLength(ROOM_CODE_LENGTH);
  for (const char of code) {
    expect(ROOM_CODE_CHARSET).toContain(char);
  }
});

test("generateRoomCode is deterministic with a stubbed RNG", () => {
  const spy = vi.spyOn(crypto, "getRandomValues");
  let i = 0;
  const sequence = [0, 0.5, 0.999, 0.25, 0.75, 0.1];
  const code = generateRoomCode(6, () => sequence[i++]!);
  const expected = sequence
    .map((value) => ROOM_CODE_CHARSET[Math.floor(value * ROOM_CODE_CHARSET.length)])
    .join("");
  expect(code).toBe(expected);
  expect(isValidRoomCode(code)).toBe(true);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

test("generateRoomCode draws each character with crypto.getRandomValues", () => {
  const index = 3;
  const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const view = array as Uint32Array;
    view[0] = index;
    return array;
  });

  const code = generateRoomCode();
  expect(spy).toHaveBeenCalledTimes(ROOM_CODE_LENGTH);
  expect(code).toBe(ROOM_CODE_CHARSET[index]!.repeat(ROOM_CODE_LENGTH));
  spy.mockRestore();
});

test("isValidRoomCode rejects wrong length and bad chars", () => {
  expect(isValidRoomCode("ABCDEF")).toBe(true);
  expect(isValidRoomCode("ABCDE")).toBe(false);
  expect(isValidRoomCode("ABCDEFG")).toBe(false);
  expect(isValidRoomCode("ABCDE0")).toBe(false); // 0 excluded
  expect(isValidRoomCode("ABCDEO")).toBe(false); // O excluded
  expect(isValidRoomCode("ABCDEI")).toBe(false); // I excluded
  expect(isValidRoomCode("abcdef")).toBe(false); // lowercase
  expect(isValidRoomCode(null)).toBe(false);
  expect(isValidRoomCode(undefined)).toBe(false);
});

test("parseRoomCodeInput accepts raw codes and join URLs", () => {
  expect(parseRoomCodeInput("AB3K9Q")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("  AB3K9Q  ")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("https://music.example/rooms/AB3K9Q")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("https://music.example/rooms/AB3K9Q?src=qr")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("/rooms/AB3K9Q")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("rooms/AB3K9Q")).toBe("AB3K9Q");
  expect(parseRoomCodeInput("not-a-code")).toBeNull();
  expect(parseRoomCodeInput("")).toBeNull();
});

test("buildRoomJoinUrl builds absolute join URLs", () => {
  expect(buildRoomJoinPath("AB3K9Q")).toBe("/rooms/AB3K9Q");
  expect(buildRoomJoinUrl("https://music.example", "AB3K9Q")).toBe(
    "https://music.example/rooms/AB3K9Q",
  );
  expect(buildRoomJoinUrl("https://music.example/", "AB3K9Q")).toBe(
    "https://music.example/rooms/AB3K9Q",
  );
});
