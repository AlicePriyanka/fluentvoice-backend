import { Router, Request, Response } from "express";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/therapist/patients
router.get("/patients", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Therapist] Unauthorized GET patients request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (jwt.role !== "therapist") {
      console.warn(`[Therapist] Forbidden GET patients request. User ${jwt.sub} is role ${jwt.role}, therapist role required.`);
      return res.status(403).json({ error: "Forbidden" });
    }

    console.log(`[Therapist] GET patients requested. Therapist ID: ${jwt.sub}`);

    // Fetch all patients in the system to ensure completeness
    console.log(`[Therapist] Querying users table for all patients`);
    const patients = db.prepare(`
      SELECT _id, name, email, joinedDate 
      FROM users
      WHERE role = 'patient'
    `).all() as any[];

    if (patients.length === 0) {
      console.log(`[Therapist] No patients found in the system`);
      return res.json({ patients: [] });
    }

    console.log(`[Therapist] Found ${patients.length} assigned patients. Fetching their sessions and plans...`);

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
      const hasPlan = !!plan;

      return {
        id,
        name: p.name,
        email: p.email,
        joinedDate: p.joinedDate ?? "—",
        sessionsCount: count,
        avgFluency: avgFluency,
        trend: count >= 2 ? deriveTrend(firstScore, lastScore) : "stable",
        lastSessionDate: lastDate,
        assessmentStatus: count >= 1 ? "completed" : "pending",
        treatmentPlanStatus: hasPlan ? "active" : "pending",
        condition: plan?.condition ?? "Fluency disorder",
        nextAppointment: plan?.nextAppointment ?? null,
      };
    });

    console.log(`[Therapist] SUCCESS: Returned ${result.length} patients for therapist: ${jwt.sub}`);
    return res.json({ patients: result });
  } catch (err) {
    console.error("[Therapist] Error in GET /api/therapist/patients:", err);
    return res.status(500).json({ error: "Failed to fetch patients." });
  }
});

// GET /api/therapist/patients/:id
router.get("/patients/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Therapist] Unauthorized GET patient details request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (jwt.role !== "therapist") {
      console.warn(`[Therapist] Forbidden GET patient details request. User ${jwt.sub} is role ${jwt.role}, therapist role required.`);
      return res.status(403).json({ error: "Forbidden" });
    }

    const { id } = req.params;
    console.log(`[Therapist] GET patient details requested by Therapist: ${jwt.sub} for Patient: ${id}`);

    // Fetch patient user record
    console.log(`[Therapist] Querying users table for patient ID: ${id}`);
    const patient = db.prepare(`
      SELECT _id, name, email, joinedDate 
      FROM users
      WHERE _id = ? AND role = 'patient'
    `).get(id) as any;

    if (!patient) {
      console.warn(`[Therapist] Patient Not Found: ID ${id}`);
      return res.status(404).json({ error: "Patient not found" });
    }

    // Fetch all sessions for this patient, newest first
    console.log(`[Therapist] Querying sessions table for patient ID: ${id}`);
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
        console.error("[Therapist] Failed to parse disfluencies JSON:", e);
      }

      try {
        timeline = typeof s.timeline === "string" ? JSON.parse(s.timeline) : s.timeline;
      } catch (e) {
        console.error("[Therapist] Failed to parse timeline JSON:", e);
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
    console.log(`[Therapist] Querying treatment_plans table for patient ID: ${id}`);
    const plan = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(id) as any;

    let goals = [];
    let exercises = [];

    try {
      if (plan?.goals) {
        goals = typeof plan.goals === "string" ? JSON.parse(plan.goals) : plan.goals;
      }
    } catch (e) {
      console.error("[Therapist] Failed to parse plan goals JSON:", e);
    }

    try {
      if (plan?.exercises) {
        exercises = typeof plan.exercises === "string" ? JSON.parse(plan.exercises) : plan.exercises;
      }
    } catch (e) {
      console.error("[Therapist] Failed to parse plan exercises JSON:", e);
    }

    // Fetch patient appointments history
    console.log(`[Therapist] Querying appointments history for patient ID: ${id}`);
    const appts = db.prepare(`
      SELECT * FROM appointments 
      WHERE patientId = ? 
      ORDER BY date DESC, time DESC
    `).all(id) as any[];

    const appointmentsMapped = appts.map(a => ({
      id: a._id,
      patientId: a.patientId,
      therapistId: a.therapistId,
      patientName: a.patientName,
      date: a.date,
      time: a.time,
      durationMinutes: a.durationMinutes,
      type: a.type,
      status: a.status,
      notes: a.notes,
      createdAt: a.createdAt,
    }));

    // Fetch patient treatment plan history/versions
    console.log(`[Therapist] Querying treatment plan history for patient ID: ${id}`);
    const planHistory = db.prepare(`
      SELECT * FROM treatment_plan_versions 
      WHERE patientId = ? 
      ORDER BY updatedAt DESC
    `).all(id) as any[];

    const planHistoryMapped = planHistory.map(v => {
      let vGoals = [];
      let vExercises = [];
      try {
        vGoals = typeof v.goals === "string" ? JSON.parse(v.goals) : v.goals;
      } catch {}
      try {
        vExercises = typeof v.exercises === "string" ? JSON.parse(v.exercises) : v.exercises;
      } catch {}
      return {
        id: v._id,
        goals: vGoals,
        exercises: vExercises,
        remarks: v.remarks,
        updatedAt: v.updatedAt,
      };
    });

    console.log(`[Therapist] SUCCESS: Details loaded for Patient ${id}. Sessions: ${count}, Appointments: ${appointmentsMapped.length}, Versions: ${planHistoryMapped.length}`);

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
      appointments: appointmentsMapped,
      treatmentPlanHistory: planHistoryMapped,
    });
  } catch (err) {
    console.error(`[Therapist] Error in GET /api/therapist/patients/${req.params.id}:`, err);
    return res.status(500).json({ error: "Failed to fetch patient data." });
  }
});

export default router;
