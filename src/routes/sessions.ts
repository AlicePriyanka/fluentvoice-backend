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

    console.log(`[Sessions] Retrieval requested by user: ${jwt.sub} (${jwt.role})`);

    // Query sessions from Postgres sorted by createdAt descending
    const resultsRes = await db.query(
      "SELECT * FROM sessions WHERE userId = $1 ORDER BY createdAt DESC",
      [jwt.sub]
    );
    const results = resultsRes.rows;

    console.log(`[Sessions] SUCCESS: Retrieved ${results.length} sessions for user: ${jwt.sub}`);

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
        date: new Date(s.createdAt ?? s.createdat).toLocaleString("en-IN", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: "Asia/Kolkata",
        }),
        audioUrl: s.audiourl ?? s.audioUrl ?? null,
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

    console.log(`[Sessions] Creating new session for user: ${jwt.sub}. Score: ${fluency_score}, Severity: ${severity}, Audio: ${audioUrl ? 'Yes' : 'No'}`);

    if (typeof fluency_score !== "number") {
      console.warn(`[Sessions] Bad Request: Missing fluency_score for user ${jwt.sub}`);
      return res.status(400).json({ error: "fluency_score is required." });
    }

    const sessionId = crypto.randomBytes(12).toString("hex");

    // In postgres, fluency_score is an INTEGER, ensure it's rounded
    const parsedFluencyScore = Math.round(Number(fluency_score));

    await db.query(`
      INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      sessionId,
      jwt.sub,
      parsedFluencyScore,
      severity ?? "moderate",
      speech_rate ?? 0,
      transcript ?? "",
      JSON.stringify(disfluencies ?? []),
      pauses ?? 0,
      JSON.stringify(timeline ?? []),
      audioUrl ?? null,
      new Date().toISOString()
    ]);

    console.log(`[Sessions] SUCCESS: Saved session ${sessionId} for user: ${jwt.sub}`);
    return res.status(201).json({ id: sessionId });
  } catch (err) {
    console.error("POST /api/sessions error:", err);
    return res.status(500).json({ error: "Failed to save session." });
  }
});

export default router;
