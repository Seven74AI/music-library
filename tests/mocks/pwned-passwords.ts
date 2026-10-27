import { http, HttpResponse } from "msw/http";

export const handlers = [
  http.get("https://api.pwnedpasswords.com/range/:prefix", () => {
    return new HttpResponse("", { status: 200 });
  }),
];
