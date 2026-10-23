import { useFetcher } from "react-router";
import { useEffect, useState } from "react";
import { Button } from "#app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#app/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#app/components/ui/tabs";
import { Input } from "#app/components/ui/input";
import { Label } from "#app/components/ui/label";
import { Textarea } from "#app/components/ui/textarea";
import { Icon } from "#app/components/ui/icon";
import { ImageUploader } from "#app/components/image-uploader";
import { AlbumHistoryTab } from "#app/components/album-edit-dialog/album-history-tab";
import { ArtistAutocomplete } from "#app/components/artist-autocomplete";
import { CuratorNotes } from "#app/components/curator-notes";

export interface Album {
  id: string;
  name: string;
  artistId: string;
  year: number | null;
  coverImageId: string | null;
  coverImage?: {
    objectKey: string;
  } | null;
  artist: {
    id: string;
    name: string;
  };
}

interface AlbumEditDialogProps {
  album: Album;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  currentUserId?: string;
}

function albumFormState(album: Album) {
  return {
    name: album.name,
    artistId: album.artistId,
    year: album.year?.toString() || "",
    comment: "",
  };
}

export function AlbumEditDialog({
  album,
  open,
  onOpenChange,
  onSaved,
  currentUserId,
}: AlbumEditDialogProps) {
  const editFetcher = useFetcher();
  const restoreFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState("metadata");
  const [coverImageId, setCoverImageId] = useState(album.coverImageId);
  const [coverObjectKey, setCoverObjectKey] = useState(album.coverImage?.objectKey || null);
  const [artistName, setArtistName] = useState(album.artist.name);
  const [formData, setFormData] = useState(albumFormState(album));
  const [formAlbumId, setFormAlbumId] = useState(album.id);

  if (formAlbumId !== album.id) {
    setFormAlbumId(album.id);
    setActiveTab("metadata");
    setCoverImageId(album.coverImageId);
    setCoverObjectKey(album.coverImage?.objectKey || null);
    setArtistName(album.artist.name);
    setFormData(albumFormState(album));
  }

  const isSubmitting = editFetcher.state !== "idle" || restoreFetcher.state !== "idle";
  const hasChanges =
    formData.name !== album.name ||
    formData.artistId !== album.artistId ||
    formData.year !== (album.year?.toString() || "") ||
    coverImageId !== album.coverImageId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;

    editFetcher.submit(
      {
        name: formData.name,
        artistId: formData.artistId,
        year: formData.year ? parseInt(formData.year) : null,
        coverImageId,
        comment: formData.comment,
      },
      {
        method: "POST",
        action: `/api/metadata/albums/${album.id}/edit`,
        encType: "application/json",
      },
    );
  };

  const handleRestore = (editId: string, comment: string | null) => {
    if (!comment) return;

    restoreFetcher.submit(
      { comment },
      {
        method: "POST",
        action: `/api/metadata/albums/${album.id}/restore/${editId}`,
        encType: "application/json",
      },
    );
  };

  const handleCoverUploaded = (objectKey: string, imageId: string) => {
    setCoverObjectKey(objectKey);
    setCoverImageId(imageId);
  };

  // Close the dialog and notify the parent when a save (edit or restore)
  // completes. Runs in an effect, not the render body.
  const editSucceeded = editFetcher.state === "idle" && editFetcher.data != null;
  const restoreSucceeded = restoreFetcher.state === "idle" && restoreFetcher.data != null;
  useEffect(() => {
    if (open && (editSucceeded || restoreSucceeded)) {
      onOpenChange(false);
      onSaved?.();
    }
  }, [open, editSucceeded, restoreSucceeded, onOpenChange, onSaved]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Album</DialogTitle>
          <DialogDescription>
            Update album details. All changes are logged for curator review.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full ${currentUserId ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="cover">Cover Art</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            {currentUserId ? <TabsTrigger value="notes">Notes</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="metadata" className="space-y-4 mt-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>

              <ArtistAutocomplete
                value={formData.artistId}
                artistName={artistName}
                onChange={(nextArtistId, nextArtistName) => {
                  if (!nextArtistId) return;
                  setArtistName(nextArtistName);
                  setFormData((prev) => ({ ...prev, artistId: nextArtistId }));
                }}
                required
              />

              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  min="1900"
                  max="2100"
                  value={formData.year}
                  onChange={(e) => setFormData({ ...formData, year: e.target.value })}
                  placeholder="e.g., 1969"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="comment">Comment (optional)</Label>
                <Textarea
                  id="comment"
                  value={formData.comment}
                  onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                  placeholder="Explain why you made these changes..."
                  rows={2}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={!hasChanges || isSubmitting}>
                  {isSubmitting && <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </TabsContent>

          <TabsContent value="cover" className="mt-4">
            <ImageUploader
              entityType="album"
              entityId={album.id}
              currentImageUrl={coverObjectKey}
              onImageUploaded={handleCoverUploaded}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <AlbumHistoryTab albumId={album.id} onRestore={handleRestore} />
          </TabsContent>

          {currentUserId ? (
            <TabsContent value="notes" className="mt-4">
              <CuratorNotes entityType="album" entityId={album.id} currentUserId={currentUserId} />
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
