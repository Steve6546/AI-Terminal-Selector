import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { attachments } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/attachments", async (req, res) => {
  try {
    const conversationId = req.query.conversationId
      ? parseInt(req.query.conversationId as string)
      : undefined;

    const rows = conversationId
      ? await db
          .select()
          .from(attachments)
          .where(eq(attachments.conversationId, conversationId))
          .orderBy(desc(attachments.createdAt))
      : await db
          .select()
          .from(attachments)
          .orderBy(desc(attachments.createdAt))
          .limit(50);

    res.json(
      rows.map((a) => ({
        id: a.id,
        conversationId: a.conversationId,
        fileName: a.fileName,
        fileType: a.fileType,
        createdAt: a.createdAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error({ err }, "Failed to list attachments");
    res.status(500).json({ error: "Internal server error" });
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

    const [attachment] = await db
      .insert(attachments)
      .values({
        conversationId: body.conversationId,
        fileName: body.fileName,
        fileType: body.fileType,
        content: body.content,
      })
      .returning();

    res.status(201).json({
      id: attachment.id,
      conversationId: attachment.conversationId,
      fileName: attachment.fileName,
      fileType: attachment.fileType,
      createdAt: attachment.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create attachment");
    res.status(500).json({ error: "Internal server error" });
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
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
