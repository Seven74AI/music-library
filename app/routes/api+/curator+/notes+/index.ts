import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import { requireCuratorOrAdmin } from "#app/utils/curator.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { parseMentions } from "#app/utils/mention-parser.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/index.ts";

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireCuratorOrAdmin(request);

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");

  if (!entityType || !entityId) {
    throw data(
      { error: "Validation failed", message: "entityType and entityId are required" },
      { status: 400 },
    );
  }

  if (!["track", "artist", "album"].includes(entityType)) {
    throw data(
      { error: "Validation failed", message: "entityType must be track, artist, or album" },
      { status: 400 },
    );
  }

  // Get all notes for this entity (including replies)
  const notes = await prisma.curatorNote.findMany({
    where: {
      entityType,
      entityId,
    },
    include: {
      curator: {
        select: {
          id: true,
          username: true,
          name: true,
        },
      },
      replies: {
        include: {
          curator: {
            select: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Filter to only top-level notes (parentId is null)
  const topLevelNotes = notes.filter((note) => !note.parentId);

  return data({
    notes: topLevelNotes.map((note) => ({
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
      replies: note.replies.map((reply) => ({
        id: reply.id,
        curator: {
          id: reply.curator.id,
          username: reply.curator.username,
          name: reply.curator.name,
          displayName: reply.curator.name || reply.curator.username,
        },
        content: reply.content,
        mentions: JSON.parse(reply.mentions) as string[],
        createdAt: reply.createdAt.toISOString(),
        updatedAt: reply.updatedAt.toISOString(),
      })),
    })),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const curatorId = await requireCuratorOrAdmin(request);

  const body = (await request.json()) as {
    entityType?: string;
    entityId?: string;
    content?: string;
    parentId?: string;
  };
  const { entityType, entityId, content, parentId } = body;

  // Validation
  if (!entityType || !entityId || !content) {
    throw data(
      {
        error: "Validation failed",
        message: "entityType, entityId, and content are required",
      },
      { status: 400 },
    );
  }

  if (!["track", "artist", "album"].includes(entityType)) {
    throw data(
      { error: "Validation failed", message: "entityType must be track, artist, or album" },
      { status: 400 },
    );
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

  // Verify entity exists
  if (entityType === "track") {
    const track = await prisma.track.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!track) {
      throw data({ error: "Not found", message: "Track not found" }, { status: 404 });
    }
  } else if (entityType === "artist") {
    const artist = await prisma.artist.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!artist) {
      throw data({ error: "Not found", message: "Artist not found" }, { status: 404 });
    }
  } else if (entityType === "album") {
    const album = await prisma.album.findUnique({
      where: { id: entityId },
      select: { id: true },
    });
    if (!album) {
      throw data({ error: "Not found", message: "Album not found" }, { status: 404 });
    }
  }

  // If this is a reply, verify parent exists
  if (parentId) {
    const parentNote = await prisma.curatorNote.findUnique({
      where: { id: parentId },
      select: { id: true, entityType: true, entityId: true },
    });

    if (!parentNote) {
      throw data({ error: "Not found", message: "Parent note not found" }, { status: 404 });
    }

    // Verify parent note is for the same entity
    if (parentNote.entityType !== entityType || parentNote.entityId !== entityId) {
      throw data(
        { error: "Validation failed", message: "Parent note must be for the same entity" },
        { status: 400 },
      );
    }
  }

  // Parse mentions from content
  const mentions = await parseMentions(content);

  // Create note
  const note = await prisma.curatorNote.create({
    data: {
      entityType,
      entityId,
      curatorId,
      content,
      mentions: JSON.stringify(mentions),
      parentId: parentId || null,
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

  // TODO: Send notifications to mentioned users (Phase 5B requirement)
  // This would be implemented in a separate notification service

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
