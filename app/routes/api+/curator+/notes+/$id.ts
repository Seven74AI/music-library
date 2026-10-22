import { data, type ActionFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { parseMentions } from "#app/utils/mention-parser.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/$id.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const curatorId = await requireCuratorOrAdmin(request);
  const noteId = params.id;

  if (!noteId) {
    throw data({ error: "Validation failed", message: "Note ID is required" }, { status: 400 });
  }

  if (request.method === "PUT") {
    return handleUpdate(request, noteId, curatorId);
  } else if (request.method === "DELETE") {
    return handleDelete(noteId, curatorId);
  }

  throw data({ error: "Method not allowed" }, { status: 405 });
}

async function handleUpdate(request: Request, noteId: string, curatorId: string) {
  const body = (await request.json()) as { content?: string };
  const { content } = body;

  // Validation
  if (!content) {
    throw data({ error: "Validation failed", message: "content is required" }, { status: 400 });
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw data({ error: "Validation failed", message: "content cannot be empty" }, { status: 400 });
  }

  if (content.length > 5000) {
    throw data(
      { error: "Validation failed", message: "content cannot exceed 5000 characters" },
      { status: 400 },
    );
  }

  // Get existing note
  const existingNote = await prisma.curatorNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      curatorId: true,
      entityType: true,
      entityId: true,
    },
  });

  if (!existingNote) {
    throw data({ error: "Not found", message: "Note not found" }, { status: 404 });
  }

  // Only allow curator to edit their own notes
  if (existingNote.curatorId !== curatorId) {
    throw data(
      { error: "Forbidden", message: "You can only edit your own notes" },
      { status: 403 },
    );
  }

  // Parse mentions from content
  const mentions = await parseMentions(content);

  // Update note
  const note = await prisma.curatorNote.update({
    where: { id: noteId },
    data: {
      content,
      mentions: JSON.stringify(mentions),
    },
    include: {
      curator: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
    },
  });

  return data({
    note: {
      id: note.id,
      entityType: note.entityType,
      entityId: note.entityId,
      curator: {
        id: note.curator.id,
        username: note.curator.username,
        name: note.curator.name,
        displayName: note.curator.name || note.curator.username,
      },
      content: note.content,
      mentions: JSON.parse(note.mentions) as string[],
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
      parentId: note.parentId,
    },
  });
}

async function handleDelete(noteId: string, curatorId: string) {
  // Get existing note
  const existingNote = await prisma.curatorNote.findUnique({
    where: { id: noteId },
    select: {
      id: true,
      curatorId: true,
    },
  });

  if (!existingNote) {
    throw data({ error: "Not found", message: "Note not found" }, { status: 404 });
  }

  // Only allow curator to delete their own notes
  if (existingNote.curatorId !== curatorId) {
    throw data(
      { error: "Forbidden", message: "You can only delete your own notes" },
      { status: 403 },
    );
  }

  // Delete note (cascade will delete replies due to schema)
  await prisma.curatorNote.delete({
    where: { id: noteId },
  });

  return data({ success: true });
}
