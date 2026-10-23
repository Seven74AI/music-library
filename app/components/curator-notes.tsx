import { useFetcher } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#app/components/ui/alert-dialog";
import { Button } from "#app/components/ui/button";
import { Icon } from "#app/components/ui/icon";
import { MentionAutocomplete } from "./mention-autocomplete";

interface Curator {
  id: string;
  username: string;
  name: string | null;
  displayName: string;
}

interface Note {
  id: string;
  entityType: string;
  entityId: string;
  curator: Curator;
  content: string;
  mentions: string[];
  createdAt: string;
  updatedAt: string;
  replies?: Note[];
}

interface CuratorNotesProps {
  entityType: "track" | "artist" | "album";
  entityId: string;
  currentUserId: string;
}

export function CuratorNotes({ entityType, entityId, currentUserId }: CuratorNotesProps) {
  const notesFetcher = useFetcher<{ notes: Note[] }>();
  const createFetcher = useFetcher();
  const [newNoteContent, setNewNoteContent] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; isReply: boolean } | null>(null);
  const newNoteRef = useRef<HTMLTextAreaElement | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);
  const requestKey = `${entityType}:${entityId}`;
  const notesUrl = `/api/curator/notes?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`;
  // Album, artist, and track pages keep this mounted and swap the id.
  // Drop the previous draft before paint, and don't treat the last payload as the next entity.
  const [acceptedKey, setAcceptedKey] = useState(requestKey);
  const [composerKey, setComposerKey] = useState(requestKey);
  const requestedKeyRef = useRef<string | null>(null);
  const dataAtRequestRef = useRef<unknown>(undefined);
  if (composerKey !== requestKey) {
    setComposerKey(requestKey);
    setNewNoteContent("");
    setReplyingTo(null);
    setReplyContent("");
    setEditingNote(null);
    setEditContent("");
  }

  useEffect(() => {
    if (notesFetcher.state !== "idle") return;

    if (requestedKeyRef.current !== requestKey) {
      // First mount may already be holding this entity's notes. A later id still has to load.
      if (requestedKeyRef.current === null && notesFetcher.data) {
        requestedKeyRef.current = requestKey;
        dataAtRequestRef.current = notesFetcher.data;
        return;
      }
      requestedKeyRef.current = requestKey;
      dataAtRequestRef.current = notesFetcher.data;
      notesFetcher.load(notesUrl);
      return;
    }

    // An unchanged body means the new load never replaced the previous entity. Stop retrying.
    if (
      acceptedKey !== requestKey &&
      notesFetcher.data &&
      notesFetcher.data !== dataAtRequestRef.current
    ) {
      setAcceptedKey(requestKey);
    }
  }, [acceptedKey, notesFetcher, notesFetcher.data, notesFetcher.state, notesUrl, requestKey]);

  // notesFetcher is a new object on later renders. Only a new successful
  // submission should reload notes and reset the composer.
  const handledCreateData = useRef<unknown>(null);
  useEffect(() => {
    if (createFetcher.state !== "idle" || !createFetcher.data) return;
    if (handledCreateData.current === createFetcher.data) return;
    handledCreateData.current = createFetcher.data;

    notesFetcher.load(
      `/api/curator/notes?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`,
    );
    setNewNoteContent("");
    setReplyContent("");
    setReplyingTo(null);
    setEditingNote(null);
    setEditContent("");
  }, [createFetcher.state, createFetcher.data, notesFetcher, entityType, entityId]);

  const notesAreCurrent = acceptedKey === requestKey;
  const loadedNotes = notesAreCurrent ? (notesFetcher.data?.notes ?? []) : [];
  const notes = loadedNotes.filter(
    (note) => note.entityId === entityId && note.entityType === entityType,
  );
  const showLoading = notesFetcher.state !== "idle" && (!notesAreCurrent || !notesFetcher.data);

  const handleCreateNote = () => {
    if (!newNoteContent.trim()) return;

    createFetcher.submit(
      {
        entityType,
        entityId,
        content: newNoteContent,
      },
      {
        method: "POST",
        action: "/api/curator/notes",
        encType: "application/json",
      },
    );
  };

  const handleReply = (parentId: string) => {
    if (!replyContent.trim()) return;

    createFetcher.submit(
      {
        entityType,
        entityId,
        content: replyContent,
        parentId,
      },
      {
        method: "POST",
        action: "/api/curator/notes",
        encType: "application/json",
      },
    );
  };

  const handleEdit = (noteId: string) => {
    if (!editContent.trim()) return;

    createFetcher.submit(
      {
        content: editContent,
      },
      {
        method: "PUT",
        action: `/api/curator/notes/${noteId}`,
        encType: "application/json",
      },
    );
  };

  const handleDelete = (noteId: string) => {
    setDeleteTarget({ id: noteId, isReply: false });
  };

  const handleDeleteReply = (replyId: string) => {
    setDeleteTarget({ id: replyId, isReply: true });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    createFetcher.submit(
      {},
      {
        method: "DELETE",
        action: `/api/curator/notes/${deleteTarget.id}`,
      },
    );
    setDeleteTarget(null);
  };

  const startEditing = (note: Note) => {
    setEditingNote(note.id);
    setEditContent(note.content);
  };

  const cancelEditing = () => {
    setEditingNote(null);
    setEditContent("");
  };

  const startReplying = (noteId: string) => {
    setReplyingTo(noteId);
    setReplyContent("");
  };

  const cancelReplying = () => {
    setReplyingTo(null);
    setReplyContent("");
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      {/* New Note Form */}
      <div className="space-y-2">
        <label htmlFor="new-note" className="text-sm font-medium">
          Add a note
        </label>
        <div className="relative">
          <textarea
            ref={newNoteRef}
            id="new-note"
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            placeholder="Type @ to mention a curator..."
            className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <MentionAutocomplete
            value={newNoteContent}
            onChange={setNewNoteContent}
            textareaRef={newNoteRef}
          />
        </div>
        <Button
          onClick={handleCreateNote}
          disabled={!newNoteContent.trim() || createFetcher.state !== "idle"}
          size="sm"
        >
          {createFetcher.state !== "idle" ? (
            <>
              <Icon name="update" className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Icon name="plus" className="mr-2 h-4 w-4" />
              Add Note
            </>
          )}
        </Button>
      </div>

      {/* Notes List */}
      {showLoading ? (
        <div className="flex items-center justify-center py-8">
          <Icon name="update" className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : notes.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center">
          <Icon name="file-text" className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No notes yet. Be the first to add one!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="rounded-md border border-border p-4">
              {/* Note Header */}
              <div className="mb-2 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                    {note.curator.displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{note.curator.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatTimestamp(note.createdAt)}
                      {note.updatedAt !== note.createdAt && " (edited)"}
                    </div>
                  </div>
                </div>
                {note.curator.id === currentUserId && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => startEditing(note)}
                      disabled={editingNote !== null}
                    >
                      <Icon name="pencil-1" className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(note.id)}
                      disabled={createFetcher.state !== "idle"}
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Note Content */}
              {editingNote === note.id ? (
                <div className="space-y-2">
                  <div className="relative">
                    <textarea
                      ref={editRef}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <MentionAutocomplete
                      value={editContent}
                      onChange={setEditContent}
                      textareaRef={editRef}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleEdit(note.id)}
                      disabled={!editContent.trim() || createFetcher.state !== "idle"}
                      size="sm"
                    >
                      Save
                    </Button>
                    <Button onClick={cancelEditing} variant="outline" size="sm">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="whitespace-pre-wrap text-sm">{note.content}</div>
              )}

              {/* Reply Button */}
              {editingNote !== note.id && (
                <div className="mt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startReplying(note.id)}
                    disabled={replyingTo !== null}
                  >
                    <Icon name="arrow-uturn-right" className="mr-2 h-4 w-4" />
                    Reply
                  </Button>
                </div>
              )}

              {/* Reply Form */}
              {replyingTo === note.id && (
                <div className="mt-3 space-y-2 border-l-2 border-border pl-4">
                  <div className="relative">
                    <textarea
                      ref={replyRef}
                      value={replyContent}
                      onChange={(e) => setReplyContent(e.target.value)}
                      placeholder="Type @ to mention a curator..."
                      className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    />
                    <MentionAutocomplete
                      value={replyContent}
                      onChange={setReplyContent}
                      textareaRef={replyRef}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleReply(note.id)}
                      disabled={!replyContent.trim() || createFetcher.state !== "idle"}
                      size="sm"
                    >
                      Reply
                    </Button>
                    <Button onClick={cancelReplying} variant="outline" size="sm">
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {/* Replies */}
              {note.replies && note.replies.length > 0 && (
                <div className="mt-4 space-y-3 border-l-2 border-border pl-4">
                  {note.replies.map((reply) => (
                    <div key={reply.id} className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
                            {reply.curator.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-medium">{reply.curator.displayName}</div>
                            <div className="text-xs text-muted-foreground">
                              {formatTimestamp(reply.createdAt)}
                              {reply.updatedAt !== reply.createdAt && " (edited)"}
                            </div>
                          </div>
                        </div>
                        {reply.curator.id === currentUserId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteReply(reply.id)}
                            disabled={createFetcher.state !== "idle"}
                          >
                            <Icon name="trash" className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap text-sm">{reply.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.isReply
                ? "Are you sure you want to delete this reply?"
                : "Are you sure you want to delete this note? This will also delete all replies."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
