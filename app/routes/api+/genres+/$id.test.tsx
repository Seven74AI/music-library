import { afterEach, describe, expect, test, vi } from "vitest";
import { clientAction } from "./$id.tsx";

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("clientAction for /api/genres/:id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns a rename 409 body as action data instead of throwing", async () => {
    const payload = {
      error: "A genre with this name already exists",
      genre: { id: "genre-jazz", name: "Jazz" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload, 409)));

    const result = await clientAction({
      request: new Request("http://localhost/api/genres/genre-rock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Jazz" }),
      }),
      params: { id: "genre-rock" },
    } as never);

    expect(result).toEqual(payload);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/genres/genre-rock",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  test("returns the renamed genre when the name is unique", async () => {
    const payload = {
      genre: { id: "genre-rock", name: "Rock & Roll", trackCount: 2 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload, 200)));

    const result = await clientAction({
      request: new Request("http://localhost/api/genres/genre-rock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Rock & Roll" }),
      }),
      params: { id: "genre-rock" },
    } as never);

    expect(result).toEqual(payload);
  });

  test("returns a successful delete body", async () => {
    const payload = {
      success: true,
      message: 'Genre "Rock" deleted',
      tracksAffected: 0,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(payload, 200)));

    const result = await clientAction({
      request: new Request("http://localhost/api/genres/genre-rock", {
        method: "DELETE",
      }),
      params: { id: "genre-rock" },
    } as never);

    expect(result).toEqual(payload);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "/api/genres/genre-rock",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
