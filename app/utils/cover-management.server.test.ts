import { isIP } from "node:net";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { server } from "#tests/mocks";
import { consoleWarn } from "#tests/setup/setup-test-env.ts";
import { downloadExternalImage, isRetriableImageDownloadError } from "./cover-management.server";

const PUBLIC_IPV4 = "93.184.216.34";

const { lookupMock } = vi.hoisted(() => {
  return { lookupMock: vi.fn() };
});

vi.mock("node:dns/promises", () => {
  return { lookup: lookupMock };
});

const dnsOverrides = new Map<string, string[]>();

function lookupRecords(hostname: string) {
  // Bracketed hosts are not lookup names. Returning loopback makes a missed
  // strip fail closed instead of looking like a public resolve.
  if (hostname.includes("[")) {
    return [{ address: "127.0.0.1", family: 4 }];
  }

  const override = dnsOverrides.get(hostname);
  const addresses = override ?? (isIP(hostname) ? [hostname] : [PUBLIC_IPV4]);
  return addresses.map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) {
      throw new Error(`test DNS address is not an IP: ${address}`);
    }
    return { address, family };
  });
}

function resolveHostTo(hostname: string, addresses: string | string[]) {
  dnsOverrides.set(hostname, typeof addresses === "string" ? [addresses] : addresses);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function jpegResponse(bytes: number[] = [1, 2, 3], extraHeaders: Record<string, string> = {}) {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: { "content-type": "image/jpeg", ...extraHeaders },
  });
}

function redirectResponse(location: string, status = 302) {
  return new Response(null, {
    status,
    headers: { location },
  });
}

const manualRedirect = expect.objectContaining({
  redirect: "manual",
  signal: expect.any(AbortSignal),
});

function scriptFetch(
  handle: (url: string, init: Parameters<typeof fetch>[1]) => Response | Promise<Response>,
) {
  const fetchMock = vi.mocked(globalThis.fetch);
  fetchMock.mockImplementation(async (input, init) => handle(requestUrl(input), init));
  return fetchMock;
}

beforeEach(() => {
  dnsOverrides.clear();
  lookupMock.mockReset();
  lookupMock.mockImplementation(async (hostname: string) => lookupRecords(String(hostname)));
});

describe("isRetriableImageDownloadError", () => {
  test("treats timeouts and network failures as retriable", () => {
    expect(
      isRetriableImageDownloadError(new Error("The operation was aborted due to timeout")),
    ).toBe(true);
    expect(isRetriableImageDownloadError(new Error("fetch failed"))).toBe(true);
    expect(isRetriableImageDownloadError(new Error("ECONNRESET"))).toBe(true);
  });

  test("does not treat validation errors as retriable", () => {
    expect(isRetriableImageDownloadError(new Error("Invalid content type"))).toBe(false);
    expect(isRetriableImageDownloadError("not an error")).toBe(false);
  });
});

describe("downloadExternalImage", () => {
  test("returns image buffer on success", async () => {
    server.use(
      http.get("https://example.com/cover.jpg", () =>
        HttpResponse.arrayBuffer(Uint8Array.from([1, 2, 3]).buffer, {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    );

    await expect(downloadExternalImage("https://example.com/cover.jpg")).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
  });

  test("retries transient failures and succeeds on a later attempt", async () => {
    consoleWarn.mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get("https://example.com/retry.jpg", () => {
        attempts++;
        if (attempts === 1) {
          return HttpResponse.error();
        }
        return HttpResponse.arrayBuffer(Uint8Array.from([9]).buffer, {
          headers: { "content-type": "image/jpeg" },
        });
      }),
    );

    await expect(downloadExternalImage("https://example.com/retry.jpg")).resolves.toEqual(
      Buffer.from([9]),
    );
    expect(attempts).toBe(2);
  });

  test("returns null after exhausting retries", async () => {
    consoleWarn.mockImplementation(() => {});

    server.use(http.get("https://example.com/fail.jpg", () => HttpResponse.error()));

    await expect(downloadExternalImage("https://example.com/fail.jpg")).resolves.toBeNull();
  });

  test("does not retry permanent HTTP failures", async () => {
    consoleWarn.mockImplementation(() => {});
    let attempts = 0;

    server.use(
      http.get("https://example.com/missing.jpg", () => {
        attempts++;
        return new HttpResponse(null, { status: 404, statusText: "Not Found" });
      }),
    );

    await expect(downloadExternalImage("https://example.com/missing.jpg")).resolves.toBeNull();
    expect(attempts).toBe(1);
  });
});

describe("downloadExternalImage public network policy", () => {
  // Fetch is fully stubbed. Blocked targets are never contacted.
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`unexpected fetch: ${requestUrl(input)}`);
    });
  });

  test.each([
    "http://i.ytimg.com/vi/abc/hqdefault.jpg",
    "http://127.0.0.1/cover.jpg",
    "file:///etc/passwd",
    "not a url",
  ])("rejects %s without fetching", async (url) => {
    consoleWarn.mockImplementation(() => {});
    const fetchMock = scriptFetch(async () => jpegResponse());

    await expect(downloadExternalImage(url)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([
    {
      name: "a loopback literal",
      url: "https://127.0.0.1/cover.jpg",
    },
    {
      name: "a decimal loopback literal",
      url: "https://2130706433/cover.jpg",
    },
    {
      name: "an ipv6 loopback literal",
      url: "https://[::1]/cover.jpg",
    },
    {
      name: "a cloud metadata literal",
      url: "https://169.254.169.254/latest/meta-data",
    },
    {
      name: "an ipv4-mapped metadata literal",
      url: "https://[::ffff:169.254.169.254]/latest/meta-data",
    },
    {
      name: "a loopback hostname",
      url: "https://localhost/cover.jpg",
      host: "localhost",
      addresses: ["127.0.0.1"],
    },
    {
      name: "a private 10/8 address",
      url: "https://files.internal/cover.jpg",
      host: "files.internal",
      addresses: ["10.1.2.3"],
    },
    {
      name: "a private 172.16/12 address",
      url: "https://files.internal/cover.jpg",
      host: "files.internal",
      addresses: ["172.16.5.5"],
    },
    {
      name: "a private 192.168/16 address",
      url: "https://files.internal/cover.jpg",
      host: "files.internal",
      addresses: ["192.168.1.50"],
    },
    {
      name: "a cloud metadata hostname",
      url: "https://metadata.google.internal/computeMetadata/v1/",
      host: "metadata.google.internal",
      addresses: ["169.254.169.254"],
    },
    {
      name: "an ipv6 link-local address",
      url: "https://link.local/cover.jpg",
      host: "link.local",
      addresses: ["fe80::1"],
    },
    {
      name: "an ipv6 unique-local address",
      url: "https://ula.internal/cover.jpg",
      host: "ula.internal",
      addresses: ["fd00::1"],
    },
    {
      name: "an ipv4-mapped private address",
      url: "https://mapped.internal/cover.jpg",
      host: "mapped.internal",
      addresses: ["::ffff:10.0.0.5"],
    },
  ])("rejects $name without fetching", async ({ url, host, addresses }) => {
    consoleWarn.mockImplementation(() => {});
    if (host && addresses) resolveHostTo(host, addresses);
    const fetchMock = scriptFetch(async () => jpegResponse());

    await expect(downloadExternalImage(url)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    if (host) {
      expect(lookupMock).toHaveBeenCalledWith(host, expect.objectContaining({ all: true }));
    }
  });

  test("rejects a host when any resolved address is private", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("cdn.example", ["93.184.216.34", "192.168.0.10"]);
    const fetchMock = scriptFetch(async () => jpegResponse());

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).toHaveBeenCalledWith("cdn.example", expect.objectContaining({ all: true }));
  });

  test("rejects a host that does not resolve", async () => {
    consoleWarn.mockImplementation(() => {});
    lookupMock.mockResolvedValueOnce([]);
    const fetchMock = scriptFetch(async () => jpegResponse());

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects a YouTube thumbnail that redirects to a metadata address", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("i.ytimg.com", "142.250.190.14");
    const fetchMock = scriptFetch(async (url) => {
      if (url === "https://i.ytimg.com/vi/abc/hqdefault.jpg") {
        return redirectResponse("https://169.254.169.254/latest/meta-data");
      }
      return jpegResponse();
    });

    await expect(
      downloadExternalImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      manualRedirect,
    );
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(
      "https://169.254.169.254/latest/meta-data",
    );
  });

  test("rejects a redirect to a hostname that resolves to loopback", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("cdn.example", PUBLIC_IPV4);
    resolveHostTo("rebind.example", "127.0.0.1");
    const fetchMock = scriptFetch(async (url) => {
      if (url === "https://cdn.example/cover.jpg") {
        return redirectResponse("https://rebind.example/secret.jpg");
      }
      return jpegResponse();
    });

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith(
      "rebind.example",
      expect.objectContaining({ all: true }),
    );
  });

  test("rejects a redirect whose userinfo hides a metadata host", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("cdn.example", PUBLIC_IPV4);
    const fetchMock = scriptFetch(async (url) => {
      if (url === "https://cdn.example/cover.jpg") {
        return redirectResponse("https://cdn.example@169.254.169.254/latest");
      }
      return jpegResponse();
    });

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example/cover.jpg", manualRedirect);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join("\n")).not.toContain(
      "169.254.169.254",
    );
  });

  test("does not follow a redirect to http", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("i.ytimg.com", "142.250.190.14");
    const fetchMock = scriptFetch(async (url) => {
      if (url === "https://i.ytimg.com/vi/abc/hqdefault.jpg") {
        return redirectResponse("http://i.ytimg.com/vi/abc/hqdefault.jpg");
      }
      return jpegResponse();
    });

    await expect(
      downloadExternalImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
      manualRedirect,
    );
  });

  test("downloads a public image after exactly 3 redirects", async () => {
    const urls = [0, 1, 2, 3].map((hop) => `https://cdn.example/hop-${hop}.jpg`);
    const fetchMock = scriptFetch(async (url) => {
      const index = urls.indexOf(url);
      const next = urls[index + 1];
      if (index >= 0 && next) return redirectResponse(next);
      return jpegResponse([4]);
    });

    await expect(downloadExternalImage(urls[0]!)).resolves.toEqual(Buffer.from([4]));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenLastCalledWith(urls[3], manualRedirect);
  });

  test("does not follow a fourth redirect", async () => {
    consoleWarn.mockImplementation(() => {});
    const urls = [0, 1, 2, 3, 4].map((hop) => `https://cdn.example/hop-${hop}.jpg`);
    const fetchMock = scriptFetch(async (url) => {
      const index = urls.indexOf(url);
      const next = urls[index + 1];
      if (index >= 0 && next) return redirectResponse(next);
      return jpegResponse([4]);
    });

    await expect(downloadExternalImage(urls[0]!)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).not.toContain(urls[4]);
  });

  test("downloads public https images from YouTube thumbnail hosts", async () => {
    resolveHostTo("i.ytimg.com", "142.250.190.14");
    resolveHostTo("img.youtube.com", "2606:4700:4700::1111");
    const fetchMock = scriptFetch(async () => jpegResponse([9, 8, 7]));

    await expect(
      downloadExternalImage("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"),
    ).resolves.toEqual(Buffer.from([9, 8, 7]));
    await expect(
      downloadExternalImage("https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg"),
    ).resolves.toEqual(Buffer.from([9, 8, 7]));

    expect(lookupMock).toHaveBeenCalledWith("i.ytimg.com", expect.objectContaining({ all: true }));
    expect(lookupMock).toHaveBeenCalledWith(
      "img.youtube.com",
      expect.objectContaining({ all: true }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      manualRedirect,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
      manualRedirect,
    );
  });

  test("re-checks a relative redirect on a YouTube thumbnail host", async () => {
    resolveHostTo("i.ytimg.com", "142.250.190.14");
    const fetchMock = scriptFetch(async (url) => {
      if (url === "https://i.ytimg.com/vi/abc/hqdefault.jpg") {
        return redirectResponse("/vi/abc/maxresdefault.jpg");
      }
      return jpegResponse([6]);
    });

    await expect(
      downloadExternalImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
    ).resolves.toEqual(Buffer.from([6]));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
      manualRedirect,
    );
    expect(lookupMock.mock.calls.filter((call) => call[0] === "i.ytimg.com")).toHaveLength(2);
  });

  test("downloads a public ipv6 literal", async () => {
    const fetchMock = scriptFetch(async () => jpegResponse([2, 2]));

    await expect(
      downloadExternalImage("https://[2606:4700:4700::1111]/cover.jpg"),
    ).resolves.toEqual(Buffer.from([2, 2]));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://[2606:4700:4700::1111]/cover.jpg",
      manualRedirect,
    );
  });

  test("allows an address just outside the private 172.16/12 range", async () => {
    resolveHostTo("cdn.example", "172.15.255.255");
    const fetchMock = scriptFetch(async () => jpegResponse([1, 1]));

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toEqual(
      Buffer.from([1, 1]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each<{ name: string; headers: Record<string, string>; bytes: number[] }>([
    {
      name: "a non-image content type",
      headers: { "content-type": "text/html" },
      bytes: [1, 2, 3],
    },
    {
      name: "a missing content type",
      headers: {},
      bytes: [1, 2, 3],
    },
    {
      name: "a content-length over 5 MB",
      headers: { "content-type": "image/jpeg", "content-length": String(5 * 1024 * 1024 + 1) },
      bytes: [1, 2, 3],
    },
  ])("discards $name", async ({ headers, bytes }) => {
    consoleWarn.mockImplementation(() => {});
    const fetchMock = scriptFetch(async () => {
      return new Response(Uint8Array.from(bytes), { status: 200, headers });
    });

    await expect(downloadExternalImage("https://cdn.example/cover.jpg")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("discards a body larger than the size limit", async () => {
    consoleWarn.mockImplementation(() => {});
    const fetchMock = scriptFetch(async () => jpegResponse([1, 2, 3, 4, 5]));

    await expect(downloadExternalImage("https://cdn.example/cover.jpg", 4)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not retry a rejected private address", async () => {
    consoleWarn.mockImplementation(() => {});
    resolveHostTo("files.internal", "10.9.8.7");
    const fetchMock = scriptFetch(async () => jpegResponse());

    await expect(downloadExternalImage("https://files.internal/a.jpg")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  test("retries a retriable DNS failure for a public host", async () => {
    consoleWarn.mockImplementation(() => {});
    let attempts = 0;
    lookupMock.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("getaddrinfo EAI_AGAIN i.ytimg.com");
      }
      return lookupRecords("142.250.190.14");
    });
    const fetchMock = scriptFetch(async () => jpegResponse([3]));

    await expect(
      downloadExternalImage("https://i.ytimg.com/vi/abc/hqdefault.jpg"),
    ).resolves.toEqual(Buffer.from([3]));
    expect(attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
