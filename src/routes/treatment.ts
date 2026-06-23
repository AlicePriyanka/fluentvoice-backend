import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/treatment/history
router.get("/history", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Treatment] Unauthorized GET history request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const patientId = (req.query.patientId as string) ?? jwt.sub;
    console.log(`[Treatment] GET plan history requested by User: ${jwt.sub} (${jwt.role}) for Patient ID: ${patientId}`);

    const versions = db.prepare("SELECT * FROM treatment_plan_versions WHERE patientId = ? ORDER BY updatedAt DESC").all(patientId) as any[];

    console.log(`[Treatment] SUCCESS: Retrieved ${versions.length} versions for Patient ID: ${patientId}`);

    return res.json({
      history: versions.map(v => {
        let goals = [];
        let exercises = [];
        try {
          goals = typeof v.goals === "string" ? JSON.parse(v.goals) : v.goals;
        } catch {}
        try {
          exercises = typeof v.exercises === "string" ? JSON.parse(v.exercises) : v.exercises;
        } catch {}

        return {
          id: v._id,
          goals,
          exercises,
          remarks: v.remarks,
          updatedAt: v.updatedAt,
        };
      })
    });
  } catch (err) {
    console.error("[Treatment] Error in GET /api/treatment/history:", err);
    return res.status(500).json({ error: "Failed to fetch treatment plan history." });
  }
});

// GET /api/treatment
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Treatment] Unauthorized GET request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const patientId = (req.query.patientId as string) ?? jwt.sub;
    console.log(`[Treatment] GET plan requested by User: ${jwt.sub} (${jwt.role}) for Patient ID: ${patientId}`);

    const plan = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(patientId) as any;
    if (!plan) {
      console.log(`[Treatment] No plan found in database for Patient ID: ${patientId}`);
      return res.json({ plan: null });
    }

    let goals = [];
    let exercises = [];

    try {
      if (plan.goals) {
        goals = typeof plan.goals === "string" ? JSON.parse(plan.goals) : plan.goals;
      }
    } catch (e) {
      console.error("[Treatment] Failed to parse treatment goals JSON:", e);
    }

    try {
      if (plan.exercises) {
        exercises = typeof plan.exercises === "string" ? JSON.parse(plan.exercises) : plan.exercises;
      }
    } catch (e) {
      console.error("[Treatment] Failed to parse treatment exercises JSON:", e);
    }

    console.log(`[Treatment] SUCCESS: Retrieved plan for Patient ID: ${patientId}. Goals count: ${goals.length}, Exercises count: ${exercises.length}`);

    return res.json({
      plan: {
        id: plan._id,
        patientId: plan.patientId,
        therapistId: plan.therapistId,
        goals,
        exercises,
        remarks: plan.remarks,
        updatedAt: plan.updatedAt,
      },
    });
  } catch (err) {
    console.error("[Treatment] Error in GET /api/treatment:", err);
    return res.status(500).json({ error: "Failed to fetch treatment plan." });
  }
});

// PUT /api/treatment
router.put("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Treatment] Unauthorized PUT update request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    const patientId: string = body.patientId ?? jwt.sub;
    const { goals, exercises, remarks } = body;

    console.log(`[Treatment] PUT update request received from User: ${jwt.sub} (${jwt.role}) for Patient: ${patientId}`);

    const goalsArr = Array.isArray(goals) ? goals : (goals ?? "").split("\n").filter(Boolean);
    const exercisesArr = Array.isArray(exercises) ? exercises : (exercises ?? "").split("\n").filter(Boolean);

    const nowStr = new Date().toISOString();
    const goalsJson = JSON.stringify(goalsArr);
    const exercisesJson = JSON.stringify(exercisesArr);
    const remarksStr = remarks ?? "";

    console.log(`[Treatment] Check database for existing plan for patient: ${patientId}`);
    const existing = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(patientId) as any;
    const therapistIdVal = jwt.role === "therapist" ? jwt.sub : (existing?.therapistId ?? null);

    if (existing) {
      console.log(`[Treatment] Updating existing plan in SQLite. Patient: ${patientId}, Therapist: ${therapistIdVal}`);
      db.prepare(`
        UPDATE treatment_plans
        SET goals = ?, exercises = ?, remarks = ?, therapistId = ?, updatedAt = ?
        WHERE patientId = ?
      `).run(goalsJson, exercisesJson, remarksStr, therapistIdVal, nowStr, patientId);
    } else {
      const planId = crypto.randomBytes(12).toString("hex");
      console.log(`[Treatment] Creating new treatment plan in SQLite. ID: ${planId}, Patient: ${patientId}, Therapist: ${therapistIdVal}`);
      db.prepare(`
        INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(planId, patientId, therapistIdVal, goalsJson, exercisesJson, remarksStr, nowStr);
    }

    // Save to treatment_plan_versions for history
    const versionId = crypto.randomBytes(12).toString("hex");
    console.log(`[Treatment] Saving new version history in SQLite. Version ID: ${versionId}, Patient: ${patientId}`);
    db.prepare(`
      INSERT INTO treatment_plan_versions (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(versionId, patientId, therapistIdVal, goalsJson, exercisesJson, remarksStr, nowStr);

    console.log(`[Treatment] SUCCESS: Saved plan and version history for patient ${patientId}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[Treatment] Error saving treatment plan:", err);
    return res.status(500).json({ error: "Failed to save treatment plan." });
  }
});

export default router;
