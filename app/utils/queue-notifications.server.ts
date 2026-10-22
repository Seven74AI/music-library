import { sendEmail } from "./email.server.ts";
import { prisma } from "./db.server.ts";

interface Reporter {
  id: string;
  email: string;
  username: string;
  name: string | null;
}

interface Curator {
  username: string;
  name: string | null;
}

interface QueueItem {
  entityType: string;
  entityId: string;
  issueType: string;
  description: string | null;
}

interface ResolutionEmailParams {
  reporter: Reporter;
  curator: Curator;
  item: QueueItem;
  resolution: string;
  resolutionComment: string;
}

const RESOLUTION_LABELS: Record<string, string> = {
  fixed: "Fixed",
  not_an_issue: "Not an Issue",
  duplicate: "Duplicate",
  cannot_fix: "Cannot Fix",
};

const ISSUE_TYPE_LABELS: Record<string, string> = {
  wrong_metadata: "Wrong metadata",
  missing_info: "Missing info",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  other: "Other",
};

export async function sendReviewResolutionEmail({
  reporter,
  curator,
  item,
  resolution,
  resolutionComment,
}: ResolutionEmailParams) {
  // Get entity details
  let entityName = "Unknown";

  try {
    switch (item.entityType) {
      case "track":
        const track = await prisma.track.findUnique({
          where: { id: item.entityId },
          select: { title: true, artist: { select: { name: true } } },
        });
        if (track) {
          entityName = `${track.title} - ${track.artist.name}`;
        }
        break;
      case "artist":
        const artist = await prisma.artist.findUnique({
          where: { id: item.entityId },
          select: { name: true },
        });
        if (artist) {
          entityName = artist.name;
        }
        break;
      case "album":
        const album = await prisma.album.findUnique({
          where: { id: item.entityId },
          select: { name: true, artist: { select: { name: true } } },
        });
        if (album) {
          entityName = `${album.name} - ${album.artist.name}`;
        }
        break;
    }
  } catch (err) {
    console.error("Error fetching entity details for email:", err);
  }

  const curatorName = curator.name || curator.username;
  const resolutionLabel = RESOLUTION_LABELS[resolution] || resolution;
  const issueTypeLabel = ISSUE_TYPE_LABELS[item.issueType] || item.issueType;

  const subject = `Your report has been ${resolutionLabel.toLowerCase()}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Your Report Has Been Resolved</h2>
      
      <p>Hi ${reporter.name || reporter.username},</p>
      
      <p>Your report about <strong>${entityName}</strong> has been resolved by curator <strong>${curatorName}</strong>.</p>
      
      <div style="background-color: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Issue Type:</strong> ${issueTypeLabel}</p>
        ${item.description ? `<p><strong>Your Report:</strong> ${item.description}</p>` : ""}
        <p><strong>Resolution:</strong> ${resolutionLabel}</p>
        <p><strong>Curator's Comment:</strong> ${resolutionComment}</p>
      </div>
      
      <p>Thank you for helping us maintain the quality of our music library!</p>
      
      <p style="color: #666; font-size: 14px; margin-top: 40px;">
        This is an automated email. Please do not reply to this message.
      </p>
    </div>
  `;

  const text = `
Your Report Has Been Resolved

Hi ${reporter.name || reporter.username},

Your report about "${entityName}" has been resolved by curator ${curatorName}.

Issue Type: ${issueTypeLabel}
${item.description ? `Your Report: ${item.description}\n` : ""}
Resolution: ${resolutionLabel}
Curator's Comment: ${resolutionComment}

Thank you for helping us maintain the quality of our music library!

---
This is an automated email. Please do not reply to this message.
  `.trim();

  return sendEmail({
    to: reporter.email,
    subject,
    html,
    text,
  });
}
