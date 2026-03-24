import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { attachments } from "@workspace/db";
import { eq, desc, or, and, ilike } from "drizzle-orm";
import { createHash } from "crypto";
import { handleRouteError } from "../lib/handle-error";

const router: IRouter = Router();

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "text/plain", "text/csv", "text/markdown", "text/html", "text/xml",
  "application/json", "application/xml",
  "application/pdf",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
]);

function computeChecksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function extractText(content: string, fileType: string): string | null {
  const textTypes = ["text/plain", "text/csv", "text/markdown", "text/html", "text/xml", "application/json", "application/xml"];
  if (textTypes.includes(fileType)) {
    if (fileType === "text/html") {
      return content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    }
    return content;
  }
  return null;
}

router.get("/attachments", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;

    const search = req.query.search as string | undefined;

    let query = db.select().from(attachments).$dynamic();

    const conditions = [];
    if (conversationId) {
      conditions.push(eq(attachments.conversationId, conversationId));
    }
    if (search) {
      conditions.push(
        or(
          ilike(attachments.fileName, `%${search}%`),
          ilike(attachments.extractedText, `%${search}%`)
        )!
      );
    }

    if (conditions.length === 1) {
      query = query.where(conditions[0]);
    } else if (conditions.length > 1) {
      query = query.where(and(...conditions));
    }

    const rows = await query.orderBy(desc(attachments.createdAt)).limit(50);

    res.json(
      rows.map((a) => ({
        id: a.id,
        conversationId: a.conversationId,
        fileName: a.fileName,
        fileType: a.fileType,
        sizeBytes: a.sizeBytes,
        checksum: a.checksum,
        uploadState: a.uploadState,
        parserStatus: a.parserStatus,
        createdAt: a.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list attachments");
    handleRouteError(res, err, "Internal server error");
  }
});

router.post("/attachments", async (req, res) => {
  try {
    const body = req.body as {
      conversationId?: number;
      fileName: string;
      fileType: string;
      content?: string;
    };

    if (!body.fileName || !body.fileType) {
      res.status(400).json({ error: "fileName and fileType are required" });
      return;
    }

    if (!ALLOWED_TYPES.has(body.fileType)) {
      res.status(400).json({ error: `File type '${body.fileType}' is not allowed` });
      return;
    }

    const contentBytes = body.content ? Buffer.byteLength(body.content, "utf-8") : 0;
    if (contentBytes > MAX_FILE_SIZE) {
      res.status(413).json({ error: `File too large (${contentBytes} bytes). Maximum is ${MAX_FILE_SIZE} bytes.` });
      return;
    }

    const checksum = body.content ? computeChecksum(body.content) : null;
    const extractedText = body.content ? extractText(body.content, body.fileType) : null;
    const parserStatus = body.content ? (extractedText !== null ? "complete" : "unsupported") : "pending";

    const [attachment] = await db
      .insert(attachments)
      .values({
        conversationId: body.conversationId,
        fileName: body.fileName,
        fileType: body.fileType,
        content: body.content,
        sizeBytes: contentBytes || null,
        checksum,
        uploadState: "complete",
        extractedText,
        parserStatus,
      })
      .returning();

    res.status(201).json({
      id: attachment.id,
      conversationId: attachment.conversationId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      sizeBytes: attachment.sizeBytes,
      checksum: attachment.checksum,
      uploadState: attachment.uploadState,
      parserStatus: attachment.parserStatus,
      createdAt: attachment.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create attachment");
    handleRouteError(res, err, "Internal server error");
  }
});

router.get("/attachments/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [attachment] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));

    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    res.json({
      id: attachment.id,
      conversationId: attachment.conversationId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      sizeBytes: attachment.sizeBytes,
      checksum: attachment.checksum,
      uploadState: attachment.uploadState,
      parserStatus: attachment.parserStatus,
      extractedText: attachment.extractedText,
      hasContent: !!attachment.content,
      createdAt: attachment.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get attachment");
    handleRouteError(res, err, "Internal server error");
  }
});

router.delete("/attachments/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await db
      .delete(attachments)
      .where(eq(attachments.id, id))
      .returning();

    if (deleted.length === 0) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete attachment");
    handleRouteError(res, err, "Internal server error");
  }
});

export default router;
