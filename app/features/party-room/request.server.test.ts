import { describe, expect, test } from "vitest";
import { partyRoomErrorResponse, readJsonBody } from "./request.server.ts";

function jsonRequest(body: string) {
  return new Request("http://localhost/api/rooms/ABC123/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

async function expectInvalidBody(body: string, expectedMessage: string) {
  let caught: unknown;
  try {
    await readJsonBody(jsonRequest(body));
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeTruthy();
  const response = partyRoomErrorResponse(caught);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: expectedMessage, code: "invalid_body" });
}

describe("readJsonBody", () => {
  test("rejects malformed JSON with an invalid_body 400", async () => {
    await expectInvalidBody("{ not json", "Request body must be valid JSON");
  });

  test("rejects a JSON array with an invalid_body 400", async () => {
    await expectInvalidBody("[1, 2, 3]", "Request body must be a JSON object");
  });

  test("rejects a JSON string with an invalid_body 400", async () => {
    await expectInvalidBody('"hello"', "Request body must be a JSON object");
  });

  test("rejects JSON null with an invalid_body 400", async () => {
    await expectInvalidBody("null", "Request body must be a JSON object");
  });

  test("accepts a JSON object", async () => {
    const body = await readJsonBody(jsonRequest('{"songId": "abc"}'));
    expect(body).toEqual({ songId: "abc" });
  });

  test("accepts an empty body", async () => {
    const body = await readJsonBody(jsonRequest(""));
    expect(body).toEqual({});
  });
});
