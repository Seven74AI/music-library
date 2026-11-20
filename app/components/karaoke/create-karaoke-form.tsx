import { useState } from "react";
import { Link } from "react-router";
import { Button } from "#app/components/ui/button.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Label } from "#app/components/ui/label.tsx";
import { Textarea } from "#app/components/ui/textarea.tsx";

export type KaraokeTextSource = "paste" | "track-lyrics" | "whisper" | "az-genius";
type Language = "en" | "fr";

export type CreateKaraokeTrack = {
  id: string;
  title: string;
  artist: string;
  lyrics: string | null;
};

const TEXT_SOURCES: Array<{ value: KaraokeTextSource; label: string }> = [
  { value: "paste", label: "Paste" },
  { value: "track-lyrics", label: "Use track lyrics" },
  { value: "whisper", label: "Whisper transcript" },
  { value: "az-genius", label: "AZ/Genius" },
];

type AttachedVideo = { id: string; label: string };

async function postJson(url: string, body: BodyInit) {
  try {
    const res = await fetch(url, { method: "POST", body });
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

function errorMessage(json: any, fallback: string): string {
  const fieldErrors = json?.errors;
  if (fieldErrors && typeof fieldErrors === "object") {
    const parts = Object.entries(fieldErrors).map(
      ([field, msgs]) => field + ": " + (Array.isArray(msgs) ? msgs.join(", ") : String(msgs)),
    );
    if (parts.length) return parts.join("; ");
  }
  return json?.error ?? fallback;
}

/** Create-karaoke flow for one track: language, text source, video, submit. */
export function CreateKaraokeForm({ track }: { track: CreateKaraokeTrack }) {
  const [language, setLanguage] = useState<Language>("en");
  const [textSource, setTextSource] = useState<KaraokeTextSource | null>(null);
  const [text, setText] = useState("");
  const [video, setVideo] = useState<AttachedVideo | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [busy, setBusy] = useState<null | "lyrics" | "video" | "submit">(null);
  const [error, setError] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);

  async function chooseSource(source: KaraokeTextSource) {
    setError(null);
    setTextSource(source);
    if (source === "track-lyrics") setText(track.lyrics ?? "");
    if (source === "whisper") setText("");
    if (source === "az-genius") {
      setBusy("lyrics");
      const { ok, json } = await postJson(
        "/resources/karaoke/fetch-lyrics",
        new URLSearchParams({ trackId: track.id }),
      );
      setBusy(null);
      if (ok && typeof json?.lyrics === "string") setText(json.lyrics);
      else setError(errorMessage(json, "Could not fetch lyrics"));
    }
  }

  async function uploadVideo(file: File) {
    setError(null);
    setBusy("video");
    const form = new FormData();
    form.set("trackId", track.id);
    form.set("videoFile", file);
    const { ok, json } = await postJson("/api/upload-video", form);
    setBusy(null);
    if (ok && json?.videoFile?.id) setVideo({ id: json.videoFile.id, label: file.name });
    else setError(errorMessage(json, "Video upload failed"));
  }

  async function attachYoutube() {
    setError(null);
    setBusy("video");
    const { ok, json } = await postJson(
      "/resources/karaoke/attach-youtube",
      new URLSearchParams({ trackId: track.id, url: youtubeUrl.trim() }),
    );
    setBusy(null);
    if (ok && json?.videoFile?.id) setVideo({ id: json.videoFile.id, label: "YouTube" });
    else setError(errorMessage(json, "Could not attach YouTube video"));
  }

  async function submit() {
    if (!textSource) return;
    setError(null);
    setBusy("submit");
    const params = new URLSearchParams({ trackId: track.id, language, textSource });
    if (textSource !== "whisper") params.set("text", text);
    if (video) params.set("videoFileId", video.id);
    const { ok, json } = await postJson("/resources/karaoke/create", params);
    setBusy(null);
    if (ok && json?.versionId) setVersionId(json.versionId);
    else setError(errorMessage(json, "Could not create karaoke version"));
  }

  if (versionId) {
    return (
      <div className="space-y-2" role="status">
        <p className="font-medium">Generating draft…</p>
        <p className="text-muted-foreground text-sm">
          Word timings are being generated for “{track.title}”. The draft will not be playable until
          it is marked ready.
        </p>
        <Link className="text-sm underline" to={`/library/${track.id}`} data-version-id={versionId}>
          Back to track
        </Link>
      </div>
    );
  }

  const needsText = textSource !== null && textSource !== "whisper";
  const canSubmit = textSource !== null && busy === null && (!needsText || text.trim().length > 0);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-muted-foreground text-sm">
        {track.title} — {track.artist}
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Language</legend>
        {(["en", "fr"] as const).map((value) => (
          <label key={value} className="mr-4 inline-flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="language"
              value={value}
              checked={language === value}
              onChange={() => setLanguage(value)}
            />
            {value === "en" ? "English" : "French"}
          </label>
        ))}
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-medium">Lyrics source</p>
        <div className="flex flex-wrap gap-2">
          {TEXT_SOURCES.map(({ value, label }) => (
            <Button
              key={value}
              type="button"
              variant={textSource === value ? "default" : "outline"}
              aria-pressed={textSource === value}
              disabled={
                (value === "track-lyrics" && !track.lyrics?.trim()) || busy === "lyrics"
              }
              onClick={() => void chooseSource(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {needsText ? (
          <div className="space-y-1">
            <Label htmlFor="karaoke-text">Lyrics text</Label>
            <Textarea
              id="karaoke-text"
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
        ) : null}
        {textSource === "whisper" ? (
          <p className="text-muted-foreground text-sm">
            The lyrics will be transcribed automatically from the audio.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Video (optional)</p>
        <div className="space-y-1">
          <Label htmlFor="karaoke-video-file">Upload video</Label>
          <Input
            id="karaoke-video-file"
            type="file"
            accept="video/*"
            disabled={busy === "video"}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadVideo(file);
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="karaoke-youtube-url">YouTube URL</Label>
          <div className="flex gap-2">
            <Input
              id="karaoke-youtube-url"
              type="url"
              placeholder="https://www.youtube.com/watch?v=…"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy === "video" || !youtubeUrl.trim()}
              onClick={() => void attachYoutube()}
            >
              Attach YouTube
            </Button>
          </div>
        </div>
        {busy === "video" ? <p className="text-sm">Processing video…</p> : null}
        {video ? <p className="text-sm">Video attached: {video.label}</p> : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={!canSubmit}>
        Create karaoke
      </Button>
    </form>
  );
}
