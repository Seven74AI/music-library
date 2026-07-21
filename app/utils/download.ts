type IOSNavigatorLike = Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">;

type ShareNavigatorLike = IOSNavigatorLike & Pick<Navigator, "share" | "canShare">;

type TriggerBlobDownloadOptions = {
  navigatorLike?: ShareNavigatorLike;
};

type TriggerBrowserDownloadOptions = {
  timeoutMs?: number;
};

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;

export function isIOSDevice(navigatorLike: IOSNavigatorLike = navigator): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigatorLike.userAgent) ||
    (navigatorLike.platform === "MacIntel" && navigatorLike.maxTouchPoints > 1)
  );
}

export async function triggerBrowserDownload(
  url: string,
  filename: string,
  options: TriggerBrowserDownloadOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const blob = await response.blob();
    await triggerBlobDownload(blob, filename);
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Download timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

export async function triggerBlobDownload(
  blob: Blob,
  filename: string,
  options: TriggerBlobDownloadOptions = {},
): Promise<void> {
  const navigatorLike = options.navigatorLike ?? navigator;
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
  });

  if (
    isIOSDevice(navigatorLike) &&
    typeof navigatorLike.share === "function" &&
    typeof navigatorLike.canShare === "function" &&
    navigatorLike.canShare({ files: [file] })
  ) {
    try {
      await navigatorLike.share({ files: [file] });
      return;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
