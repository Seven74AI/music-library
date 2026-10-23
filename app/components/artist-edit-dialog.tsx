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
import { ArtistHistoryTab } from "#app/components/artist-edit-dialog/artist-history-tab";
import { CuratorNotes } from "#app/components/curator-notes";

export interface Artist {
  id: string;
  name: string;
  bio: string | null;
  genre: string | null;
  country: string | null;
  imageUrl: string | null;
  website: string | null;
}

interface ArtistEditDialogProps {
  artist: Artist;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  currentUserId?: string;
}

function artistFormState(artist: Artist) {
  return {
    name: artist.name,
    bio: artist.bio || "",
    genre: artist.genre || "",
    country: artist.country || "",
    imageUrl: artist.imageUrl || "",
    website: artist.website || "",
    comment: "",
  };
}

export function ArtistEditDialog({
  artist,
  open,
  onOpenChange,
  onSaved,
  currentUserId,
}: ArtistEditDialogProps) {
  const editFetcher = useFetcher();
  const restoreFetcher = useFetcher();
  const [activeTab, setActiveTab] = useState("metadata");
  const [formData, setFormData] = useState(artistFormState(artist));
  const [formArtistId, setFormArtistId] = useState(artist.id);

  if (formArtistId !== artist.id) {
    setFormArtistId(artist.id);
    setActiveTab("metadata");
    setFormData(artistFormState(artist));
  }

  const isSubmitting = editFetcher.state !== "idle" || restoreFetcher.state !== "idle";
  const hasChanges =
    formData.name !== artist.name ||
    formData.bio !== (artist.bio || "") ||
    formData.genre !== (artist.genre || "") ||
    formData.country !== (artist.country || "") ||
    formData.imageUrl !== (artist.imageUrl || "") ||
    formData.website !== (artist.website || "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasChanges) return;

    editFetcher.submit(
      {
        name: formData.name,
        bio: formData.bio || null,
        genre: formData.genre || null,
        country: formData.country || null,
        imageUrl: formData.imageUrl || null,
        website: formData.website || null,
        comment: formData.comment,
      },
      {
        method: "POST",
        action: `/api/metadata/artists/${artist.id}/edit`,
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
        action: `/api/metadata/artists/${artist.id}/restore/${editId}`,
        encType: "application/json",
      },
    );
  };

  const handleImageUploaded = (objectKey: string) => {
    setFormData({ ...formData, imageUrl: objectKey });
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
          <DialogTitle>Edit Artist</DialogTitle>
          <DialogDescription>
            Update artist details. All changes are logged for curator review.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className={`grid w-full ${currentUserId ? "grid-cols-4" : "grid-cols-3"}`}>
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
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

              <div className="space-y-2">
                <Label htmlFor="bio">Biography</Label>
                <Textarea
                  id="bio"
                  value={formData.bio}
                  onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                  rows={4}
                  placeholder="Add artist biography..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="genre">Genre</Label>
                  <Input
                    id="genre"
                    value={formData.genre}
                    onChange={(e) => setFormData({ ...formData, genre: e.target.value })}
                    placeholder="e.g., Rock, Pop, Jazz"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={formData.country}
                    onChange={(e) => setFormData({ ...formData, country: e.target.value })}
                    placeholder="e.g., United States, UK"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  placeholder="https://artist-website.com"
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

          <TabsContent value="image" className="mt-4">
            <ImageUploader
              entityType="artist"
              entityId={artist.id}
              currentImageUrl={formData.imageUrl}
              onImageUploaded={handleImageUploaded}
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <ArtistHistoryTab artistId={artist.id} onRestore={handleRestore} />
          </TabsContent>

          {currentUserId ? (
            <TabsContent value="notes" className="mt-4">
              <CuratorNotes
                entityType="artist"
                entityId={artist.id}
                currentUserId={currentUserId}
              />
            </TabsContent>
          ) : null}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
