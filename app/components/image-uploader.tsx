import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "#app/components/ui/button";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Icon } from "#app/components/ui/icon";
import { coverImageUrl } from "#app/utils/cover-image-url";

interface ImageUploaderProps {
  entityType: "artist" | "album";
  entityId: string;
  currentImageUrl?: string | null;
  onImageUploaded?: (objectKey: string, imageId: string) => void;
}

export function ImageUploader({
  entityType,
  entityId,
  currentImageUrl,
  onImageUploaded,
}: ImageUploaderProps) {
  const uploadFetcher = useFetcher();
  const urlFetcher = useFetcher();
  const [imageUrl, setImageUrl] = useState("");
  const [uploadMethod, setUploadMethod] = useState<"file" | "url">("file");
  const uploadTargetRef = useRef<{ entityType: string; entityId: string } | null>(null);
  const scope = `${entityType}:${entityId}`;
  const [appliedScope, setAppliedScope] = useState(scope);
  // Album and artist editors stay mounted when the route param changes.
  if (appliedScope !== scope) {
    setAppliedScope(scope);
    setImageUrl("");
    uploadTargetRef.current = null;
  }

  const isUploading = uploadFetcher.state !== "idle" || urlFetcher.state !== "idle";

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    uploadTargetRef.current = { entityType, entityId };
    const formData = new FormData();
    formData.append("image", file);
    formData.append("entityType", entityType);
    formData.append("entityId", entityId);

    uploadFetcher.submit(formData, {
      method: "POST",
      action: "/api/images/upload",
      encType: "multipart/form-data",
    });
  };

  const handleUrlUpload = () => {
    if (!imageUrl.trim()) return;

    uploadTargetRef.current = { entityType, entityId };
    urlFetcher.submit(
      {
        url: imageUrl,
        entityType,
        entityId,
      },
      {
        method: "POST",
        action: "/api/images/from-url",
        encType: "application/json",
      },
    );
  };

  const uploadStillForThisEntity = () =>
    uploadTargetRef.current?.entityType === entityType &&
    uploadTargetRef.current?.entityId === entityId;

  // Handle successful uploads
  if (uploadFetcher.data?.success && onImageUploaded) {
    const objectKey = uploadFetcher.data.image.objectKey;
    const imageId = uploadFetcher.data.image.id;
    if (!uploadStillForThisEntity()) {
      uploadFetcher.data = null;
    } else {
      const submittedType = entityType;
      const submittedId = entityId;
      setTimeout(() => {
        if (
          uploadTargetRef.current?.entityType !== submittedType ||
          uploadTargetRef.current?.entityId !== submittedId
        ) {
          return;
        }
        onImageUploaded(objectKey, imageId);
        // Reset fetcher to prevent infinite loop
        uploadFetcher.data = null;
      }, 0);
    }
  }

  if (urlFetcher.data?.success && onImageUploaded) {
    const objectKey = urlFetcher.data.image.objectKey;
    const imageId = urlFetcher.data.image.id;
    if (!uploadStillForThisEntity()) {
      urlFetcher.data = null;
    } else {
      const submittedType = entityType;
      const submittedId = entityId;
      setTimeout(() => {
        if (
          uploadTargetRef.current?.entityType !== submittedType ||
          uploadTargetRef.current?.entityId !== submittedId
        ) {
          return;
        }
        onImageUploaded(objectKey, imageId);
        setImageUrl("");
        // Reset fetcher to prevent infinite loop
        urlFetcher.data = null;
      }, 0);
    }
  }

  return (
    <div className="space-y-4">
      {/* Current Image Preview */}
      {currentImageUrl && (
        <div className="flex items-center gap-4">
          <div className="relative h-32 w-32 rounded-lg overflow-hidden bg-muted">
            <img
              src={coverImageUrl(currentImageUrl, 128)}
              alt="Current image"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="text-sm text-muted-foreground">Current image</div>
        </div>
      )}

      {/* Upload Method Tabs */}
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setUploadMethod("file")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            uploadMethod === "file"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Upload File
        </button>
        <button
          type="button"
          onClick={() => setUploadMethod("url")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            uploadMethod === "url"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          From URL
        </button>
      </div>

      {/* File Upload */}
      {uploadMethod === "file" && (
        <div className="space-y-2">
          <Label htmlFor="image-file">Choose Image File</Label>
          <Input
            id="image-file"
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            onChange={handleFileUpload}
            disabled={isUploading}
          />
          <p className="text-xs text-muted-foreground">
            Minimum size: 500x500px. Formats: JPEG, PNG, WebP. Max size: 10MB.
          </p>
        </div>
      )}

      {/* URL Upload */}
      {uploadMethod === "url" && (
        <div className="space-y-2">
          <Label htmlFor="image-url">Image URL</Label>
          <div className="flex gap-2">
            <Input
              id="image-url"
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              disabled={isUploading}
            />
            <Button
              type="button"
              onClick={handleUrlUpload}
              disabled={!imageUrl.trim() || isUploading}
            >
              {isUploading && <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />}
              Upload
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter a direct link to an image. Minimum size: 500x500px.
          </p>
        </div>
      )}

      {/* Upload Status */}
      {isUploading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon name="update" className="h-4 w-4 animate-spin" />
          Uploading image...
        </div>
      )}

      {/* Error Messages */}
      {uploadFetcher.data?.error && (
        <div className="text-sm text-destructive">{uploadFetcher.data.error}</div>
      )}
      {urlFetcher.data?.error && (
        <div className="text-sm text-destructive">{urlFetcher.data.error}</div>
      )}
    </div>
  );
}
