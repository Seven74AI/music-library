import { beforeEach, describe, expect, test, vi } from "vitest";
import { consoleWarn } from "#tests/setup/setup-test-env.ts";
import { validatePublicHttpsUrl } from "./validate-public-url.server.ts";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

describe("validatePublicHttpsUrl", () => {
  beforeEach(() => {
    consoleWarn.mockImplementation(() => {});
    lookupMock.mockReset();
  });

  test("rejects literal RFC 6598 shared address space hosts (100.64.0.0/10)", async () => {
    const result = await validatePublicHttpsUrl("https://100.64.1.2/cover.png");
    expect(result).toBeNull();
  });

  test("rejects hostnames resolving to 100.64.x.x", async () => {
    lookupMock.mockResolvedValue([{ address: "100.64.9.1", family: 4 }]);

    const result = await validatePublicHttpsUrl("https://cdn.example/cover.png");
    expect(result).toBeNull();
    expect(lookupMock).toHaveBeenCalled();
  });

  test("rejects 0.0.0.0", async () => {
    const result = await validatePublicHttpsUrl("https://0.0.0.0/image.png");
    expect(result).toBeNull();
  });
});
