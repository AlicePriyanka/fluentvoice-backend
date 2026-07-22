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

    const versionsRes = await db.query(
      "SELECT * FROM treatment_plan_versions WHERE patientId = $1 ORDER BY updatedAt DESC",
      [patientId]
    );
    const versions = versionsRes.rows;

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
          updatedAt: v.updatedAt ?? v.updatedat,
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

    const planRes = await db.query("SELECT * FROM treatment_plans WHERE patientId = $1", [patientId]);
    const plan = planRes.rows[0];

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
        patientId: plan.patientId ?? plan.patientid,
        therapistId: plan.therapistId ?? plan.therapistid,
        goals,
        exercises,
        remarks: plan.remarks,
        updatedAt: plan.updatedAt ?? plan.updatedat,
      },
    });
  } catch (err) {
    console.error("[Treatment] Error in GET /api/treatment:", err);
    return res.status(500).json({ error: "Failed to fetch treatment plan." });
  }
});

// PUT /api/treatment
router.put("/", async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      client.release();
      console.warn("[Treatment] Unauthorized PUT update request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    const patientId: string = body.patientId ?? jwt.sub;
    const { goals, exercises, remarks } = body;

    console.log(`[Treatment] PUT update request received from User: ${jwt.sub} (${jwt.role}) for Patient: ${patientId}`);

    const goalsArr = Array.isArray(goals) ? goals : (goals ?? "").split("\\n").filter(Boolean);
    const exercisesArr = Array.isArray(exercises) ? exercises : (exercises ?? "").split("\\n").filter(Boolean);

    const nowStr = new Date().toISOString();
    const goalsJson = JSON.stringify(goalsArr);
    const exercisesJson = JSON.stringify(exercisesArr);
    const remarksStr = remarks ?? "";

    console.log(`[Treatment] Check database for existing plan for patient: ${patientId}`);
    
    await client.query("BEGIN");
    
    const existingRes = await client.query("SELECT * FROM treatment_plans WHERE patientId = $1", [patientId]);
    const existing = existingRes.rows[0];
    const therapistIdVal = jwt.role === "therapist" ? jwt.sub : (existing?.therapistId ?? existing?.therapistid ?? null);

    if (existing) {
      console.log(`[Treatment] Updating existing plan in Postgres. Patient: ${patientId}, Therapist: ${therapistIdVal}`);
      await client.query(`
        UPDATE treatment_plans
        SET goals = $1, exercises = $2, remarks = $3, therapistId = $4, updatedAt = $5
        WHERE patientId = $6
      `, [goalsJson, exercisesJson, remarksStr, therapistIdVal, nowStr, patientId]);
    } else {
      const planId = crypto.randomBytes(12).toString("hex");
      console.log(`[Treatment] Creating new treatment plan in Postgres. ID: ${planId}, Patient: ${patientId}, Therapist: ${therapistIdVal}`);
      await client.query(`
        INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [planId, patientId, therapistIdVal, goalsJson, exercisesJson, remarksStr, nowStr]);
    }

    // Save to treatment_plan_versions for history
    const versionId = crypto.randomBytes(12).toString("hex");
    console.log(`[Treatment] Saving new version history in Postgres. Version ID: ${versionId}, Patient: ${patientId}`);
    await client.query(`
      INSERT INTO treatment_plan_versions (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [versionId, patientId, therapistIdVal, goalsJson, exercisesJson, remarksStr, nowStr]);

    await client.query("COMMIT");
    client.release();
    
    console.log(`[Treatment] SUCCESS: Saved plan and version history for patient ${patientId}`);
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    console.error("[Treatment] Error saving treatment plan:", err);
    return res.status(500).json({ error: "Failed to save treatment plan." });
  }
});

export default router;
