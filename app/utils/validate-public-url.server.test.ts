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

  test("rejects 0.0.0.0/8", async () => {
    await expect(validatePublicHttpsUrl("https://0.0.0.0/image.png")).resolves.toBeNull();
    await expect(validatePublicHttpsUrl("https://0.0.0.1/image.png")).resolves.toBeNull();
  });

  test.each([
    "https://[::]/image.png",
    "https://[::]:8443/image.png",
    "https://[::0]/image.png",
    "https://[0::0]/image.png",
  ])("rejects IPv6 unspecified address %s", async (url) => {
    const result = await validatePublicHttpsUrl(url);
    expect(result).toBeNull();
  });

  test("rejects 6to4 when embedded IPv4 is non-public", async () => {
    await expect(validatePublicHttpsUrl("https://[2002:7f00:1::]/image.png")).resolves.toBeNull();
  });

  test("rejects entire NAT64 64:ff9b::/96 prefix", async () => {
    await expect(validatePublicHttpsUrl("https://[64:ff9b::7f00:1]/image.png")).resolves.toBeNull();
    await expect(validatePublicHttpsUrl("https://[64:ff9b::a00:1]/image.png")).resolves.toBeNull();
    await expect(
      validatePublicHttpsUrl("https://[64:ff9b:1:1::7f00:1]/image.png"),
    ).resolves.toBeNull();
  });
});
