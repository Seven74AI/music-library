import { mkdir, mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getFileUrl } from "#app/utils/storage.server.ts";
import { loader } from "./images.tsx";

vi.mock("#app/utils/storage.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/storage.server.ts")>();
  return {
    ...actual,
    getFileUrl: vi.fn(),
  };
});

const PUBLIC_ROOT = path.resolve(process.cwd(), "public");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let fixtureDir: string;
let assetDir: string;

beforeEach(async () => {
  fixtureDir = await mkdtemp(path.join(PUBLIC_ROOT, "image-fixture-"));
  await writeFile(path.join(fixtureDir, "pixel.png"), PNG);

  const id = path.basename(fixtureDir);
  assetDir = path.join(PUBLIC_ROOT, "assets", id);
  await mkdir(assetDir, { recursive: true });
  await writeFile(path.join(assetDir, "pixel.png"), PNG);
});

afterEach(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
  await rm(assetDir, { recursive: true, force: true });
  await rmdir(path.join(PUBLIC_ROOT, "assets")).catch(() => {});
  vi.unstubAllGlobals();
});

function fixtureSrc(): string {
  return path.relative(PUBLIC_ROOT, path.join(fixtureDir, "pixel.png")).split(path.sep).join("/");
}

function assetSrc(): string {
  const id = path.basename(fixtureDir);
  return `/assets/${id}/pixel.png`;
}

async function load(params: Record<string, string>): Promise<Response> {
  const url = new URL("http://localhost/resources/images");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const request = new Request(url);
  try {
    return await loader({
      request,
      url,
      params: {},
      context: {},
    } as never);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

describe("GET /resources/images filesystem confinement", () => {
  test("serves a relative file that stays inside public/", async () => {
    const response = await load({ src: fixtureSrc() });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\//);
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("serves a root-relative public file and an /assets file inside public/", async () => {
    const publicResponse = await load({ src: `/${fixtureSrc()}` });
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("content-type")).toMatch(/^image\//);

    const assetsResponse = await load({ src: assetSrc() });
    expect(assetsResponse.status).toBe(200);
    expect(assetsResponse.headers.get("content-type")).toMatch(/^image\//);
  });

  test("rejects a src or objectKey that contains ..", async () => {
    const srcResponse = await load({ src: `${path.basename(fixtureDir)}/../missing-image.png` });
    expect(srcResponse.status).toBe(400);

    const assetsResponse = await load({ src: "/assets/../missing-image.png" });
    expect(assetsResponse.status).toBe(400);

    const keyResponse = await load({ objectKey: "images/../missing-image.png" });
    expect(keyResponse.status).toBe(400);
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  test("rejects a src or objectKey that contains a null byte", async () => {
    const srcResponse = await load({ src: "a\0b.png" });
    expect(srcResponse.status).toBe(400);

    const keyResponse = await load({ objectKey: "images/a\0b.png" });
    expect(keyResponse.status).toBe(400);
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  test("rejects an absolute src or objectKey", async () => {
    const driveResponse = await load({ src: "C:/outside.png" });
    expect(driveResponse.status).toBe(400);

    const uncResponse = await load({ src: "//outside.png" });
    expect(uncResponse.status).toBe(400);

    const keyResponse = await load({ objectKey: "/images/covers/a.png" });
    expect(keyResponse.status).toBe(400);
    expect(getFileUrl).not.toHaveBeenCalled();
  });

  test("keeps remote src values on the origin allowlist", async () => {
    const blocked = await load({ src: "https://example.com/pixel.png" });
    expect(blocked.status).toBe(403);

    const allowedSrc = `https://i.ytimg.com/vi/abc/${crypto.randomUUID()}.jpg`;
    const fetchMock = vi.fn(async (input: unknown) => {
      expect(String(input)).toBe(allowedSrc);
      return new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const allowed = await load({ src: allowedSrc });
    expect(allowed.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  test("still signs a valid storage key", async () => {
    vi.mocked(getFileUrl).mockResolvedValue({
      url: "https://i.ytimg.com/fixture.png",
      headers: { Authorization: "signed" },
    });
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("signed");
      return new Response(PNG, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await load({ objectKey: "images/covers/fixture.png" });

    expect(getFileUrl).toHaveBeenCalledWith("images/covers/fixture.png", 3600);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\//);
  });
});
