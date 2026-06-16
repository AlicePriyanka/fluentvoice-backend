import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/sessions
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    // Query sessions from SQLite sorted by createdAt descending
    const results = db.prepare(
      "SELECT * FROM sessions WHERE userId = ? ORDER BY createdAt DESC"
    ).all(jwt.sub) as any[];

    const mapped = results.map((s) => {
      let disfluencies = [];
      let timeline = [];

      try {
        disfluencies = typeof s.disfluencies === "string" ? JSON.parse(s.disfluencies) : s.disfluencies;
      } catch (e) {
        console.error("Failed to parse disfluencies JSON", e);
      }

      try {
        timeline = typeof s.timeline === "string" ? JSON.parse(s.timeline) : s.timeline;
      } catch (e) {
        console.error("Failed to parse timeline JSON", e);
      }

      return {
        id: s._id,
        date: new Date(s.createdAt).toLocaleString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }),
        audioUrl: s.audioUrl ?? null,
        report: {
          fluency_score: s.fluency_score,
          severity: s.severity,
          speech_rate: s.speech_rate,
          transcript: s.transcript,
          disfluencies,
          pauses: s.pauses,
          timeline,
        },
      };
    });

    return res.json({ sessions: mapped });
  } catch (err) {
    console.error("GET /api/sessions error:", err);
    return res.status(500).json({ error: "Failed to fetch sessions." });
  }
});

// POST /api/sessions
router.post("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const {
      fluency_score,
      severity,
      speech_rate,
      transcript,
      disfluencies,
      pauses,
      timeline,
      audioUrl,
    } = req.body;

    if (typeof fluency_score !== "number") {
      return res.status(400).json({ error: "fluency_score is required." });
    }

    const sessionId = crypto.randomBytes(12).toString("hex");

    db.prepare(`
      INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      jwt.sub,
      fluency_score,
      severity ?? "moderate",
      speech_rate ?? 0,
      transcript ?? "",
      JSON.stringify(disfluencies ?? []),
      pauses ?? 0,
      JSON.stringify(timeline ?? []),
      audioUrl ?? null,
      new Date().toISOString()
    );

    return res.status(201).json({ id: sessionId });
  } catch (err) {
    console.error("POST /api/sessions error:", err);
    return res.status(500).json({ error: "Failed to save session." });
  }
});

export default router;
