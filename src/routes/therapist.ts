import { Router, Request, Response } from "express";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/therapist/patients
router.get("/patients", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });
    if (jwt.role !== "therapist") return res.status(403).json({ error: "Forbidden" });

    // Fetch only patients assigned to THIS therapist
    const patients = db.prepare(`
      SELECT _id, name, email, joinedDate 
      FROM users
      WHERE role = 'patient' AND therapistId = ?
    `).all(jwt.sub) as any[];

    if (patients.length === 0) {
      return res.json({ patients: [] });
    }

    const patientIds = patients.map((p) => p._id);
    const placeholders = patientIds.map(() => "?").join(",");

    // Fetch all sessions for these patients, ordered by creation date ascending
    const sessions = db.prepare(`
      SELECT _id, userId, fluency_score, createdAt
      FROM sessions
      WHERE userId IN (${placeholders})
      ORDER BY createdAt ASC
    `).all(...patientIds) as any[];

    // Group sessions by patient
    const sessionsByPatient: Record<string, any[]> = {};
    for (const pId of patientIds) {
      sessionsByPatient[pId] = [];
    }
    for (const s of sessions) {
      if (sessionsByPatient[s.userId]) {
        sessionsByPatient[s.userId].push(s);
      }
    }

    // Fetch treatment plans for these patients
    const allPlans = db.prepare(`
      SELECT * FROM treatment_plans
      WHERE patientId IN (${placeholders})
    `).all(...patientIds) as any[];

    const planMap: Record<string, any> = {};
    for (const pl of allPlans) {
      planMap[pl.patientId] = pl;
    }

    function deriveTrend(first: number, last: number): "improving" | "stable" | "declining" {
      if (last - first > 5) return "improving";
      if (first - last > 5) return "declining";
      return "stable";
    }

    const result = patients.map((p) => {
      const id = p._id;
      const patientSessions = sessionsByPatient[id] || [];
      const count = patientSessions.length;

      let avgFluency = 0;
      let firstScore = 0;
      let lastScore = 0;
      let lastDate = null;

      if (count > 0) {
        const sum = patientSessions.reduce((acc, curr) => acc + curr.fluency_score, 0);
        avgFluency = Math.round(sum / count);
        firstScore = patientSessions[0].fluency_score;
        lastScore = patientSessions[count - 1].fluency_score;
        lastDate = patientSessions[count - 1].createdAt;
      }

      const plan = planMap[id];

      return {
        id,
        name: p.name,
        email: p.email,
        joinedDate: p.joinedDate ?? "—",
        sessionsCount: count,
        avgFluency: avgFluency,
        trend: count >= 2 ? deriveTrend(firstScore, lastScore) : "stable",
        lastSessionDate: lastDate,
        condition: plan?.condition ?? null,
        nextAppointment: plan?.nextAppointment ?? null,
      };
    });

    return res.json({ patients: result });
  } catch (err) {
    console.error("GET /api/therapist/patients error:", err);
    return res.status(500).json({ error: "Failed to fetch patients." });
  }
});

// GET /api/therapist/patients/:id
router.get("/patients/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });
    if (jwt.role !== "therapist") return res.status(403).json({ error: "Forbidden" });

    const { id } = req.params;

    // Fetch patient user record
    const patient = db.prepare(`
      SELECT _id, name, email, joinedDate 
      FROM users
      WHERE _id = ? AND role = 'patient'
    `).get(id) as any;

    if (!patient) return res.status(404).json({ error: "Patient not found" });

    // Fetch all sessions for this patient, newest first
    const rawSessions = db.prepare(`
      SELECT * FROM sessions
      WHERE userId = ?
      ORDER BY createdAt DESC
    `).all(id) as any[];

    const mappedSessions = rawSessions.map((s) => {
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
        createdAt: s.createdAt,
        fluency_score: s.fluency_score,
        severity: s.severity,
        speech_rate: s.speech_rate,
        transcript: s.transcript,
        disfluencies,
        pauses: s.pauses ?? 0,
        timeline,
        audioUrl: s.audioUrl ?? null,
      };
    });

    // Compute stats
    const count = mappedSessions.length;
    const avgFluency = count > 0
      ? Math.round(mappedSessions.reduce((s, r) => s + r.fluency_score, 0) / count)
      : 0;

    let trend: "improving" | "stable" | "declining" = "stable";
    if (count >= 2) {
      const first = mappedSessions[count - 1].fluency_score;
      const last  = mappedSessions[0].fluency_score;
      if (last - first > 5) trend = "improving";
      else if (first - last > 5) trend = "declining";
    }

    // Fetch treatment plan
    const plan = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(id) as any;

    let goals = [];
    let exercises = [];

    try {
      if (plan?.goals) {
        goals = typeof plan.goals === "string" ? JSON.parse(plan.goals) : plan.goals;
      }
    } catch (e) {
      console.error("Failed to parse plan goals JSON", e);
    }

    try {
      if (plan?.exercises) {
        exercises = typeof plan.exercises === "string" ? JSON.parse(plan.exercises) : plan.exercises;
      }
    } catch (e) {
      console.error("Failed to parse plan exercises JSON", e);
    }

    return res.json({
      patient: {
        id,
        name: patient.name,
        email: patient.email,
        joinedDate: patient.joinedDate ?? "—",
        condition: plan?.condition ?? "Fluency disorder",
        nextAppointment: plan?.nextAppointment ?? null,
        goals,
        exercises,
        remarks: plan?.remarks ?? "",
      },
      stats: { count, avgFluency, trend },
      sessions: mappedSessions,
    });
  } catch (err) {
    console.error("GET /api/therapist/patients/:id error:", err);
    return res.status(500).json({ error: "Failed to fetch patient data." });
  }
});

export default router;
