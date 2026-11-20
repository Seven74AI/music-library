/** POST form-encoded params to a karaoke resource route; never throws. */
export async function postForm(url: string, params: Record<string, string>) {
  try {
    const res = await fetch(url, { method: "POST", body: new URLSearchParams(params) });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // non-JSON body (e.g. a redirected login page)
    }
    return { ok: res.ok && json?.success === true, json };
  } catch {
    return { ok: false, json: { error: "Network error. Please try again." } };
  }
}

/** `{success:false, error}` or zod `{errors:{field:[msg]}}` → one message. */
export function errorMessage(json: any, fallback: string): string {
  const fieldErrors = json?.errors;
  if (fieldErrors && typeof fieldErrors === "object") {
    const parts = Object.entries(fieldErrors).map(
      ([field, msgs]) => field + ": " + (Array.isArray(msgs) ? msgs.join(", ") : String(msgs)),
    );
    if (parts.length) return parts.join("; ");
  }
  return json?.error ?? fallback;
}
