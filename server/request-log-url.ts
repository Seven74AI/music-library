/** Morgan `url` token: pathname only — never log query strings (OTP links, OAuth state). */
export function requestUrlForAccessLog(rawUrl: string | undefined): string {
  const url = rawUrl ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    decoded = url;
  }

  const queryStart = decoded.indexOf("?");
  const hashStart = decoded.indexOf("#");
  let end = decoded.length;
  if (queryStart >= 0) end = Math.min(end, queryStart);
  if (hashStart >= 0) end = Math.min(end, hashStart);
  return decoded.slice(0, end);
}
