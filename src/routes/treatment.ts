import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/treatment
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const patientId = (req.query.patientId as string) ?? jwt.sub;

    const plan = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(patientId) as any;
    if (!plan) {
      return res.json({ plan: null });
    }

    let goals = [];
    let exercises = [];

    try {
      if (plan.goals) {
        goals = typeof plan.goals === "string" ? JSON.parse(plan.goals) : plan.goals;
      }
    } catch (e) {
      console.error("Failed to parse treatment goals JSON", e);
    }

    try {
      if (plan.exercises) {
        exercises = typeof plan.exercises === "string" ? JSON.parse(plan.exercises) : plan.exercises;
      }
    } catch (e) {
      console.error("Failed to parse treatment exercises JSON", e);
    }

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
    console.error("GET /api/treatment error:", err);
    return res.status(500).json({ error: "Failed to fetch treatment plan." });
  }
});

// PUT /api/treatment
router.put("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const body = req.body;
    const patientId: string = body.patientId ?? jwt.sub;
    const { goals, exercises, remarks } = body;

    const goalsArr = Array.isArray(goals) ? goals : (goals ?? "").split("\n").filter(Boolean);
    const exercisesArr = Array.isArray(exercises) ? exercises : (exercises ?? "").split("\n").filter(Boolean);

    const nowStr = new Date().toISOString();
    const goalsJson = JSON.stringify(goalsArr);
    const exercisesJson = JSON.stringify(exercisesArr);
    const remarksStr = remarks ?? "";

    const existing = db.prepare("SELECT * FROM treatment_plans WHERE patientId = ?").get(patientId) as any;
    const therapistIdVal = jwt.role === "therapist" ? jwt.sub : (existing?.therapistId ?? null);

    if (existing) {
      db.prepare(`
        UPDATE treatment_plans
        SET goals = ?, exercises = ?, remarks = ?, therapistId = ?, updatedAt = ?
        WHERE patientId = ?
      `).run(goalsJson, exercisesJson, remarksStr, therapistIdVal, nowStr, patientId);
    } else {
      const planId = crypto.randomBytes(12).toString("hex");
      db.prepare(`
        INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(planId, patientId, therapistIdVal, goalsJson, exercisesJson, remarksStr, nowStr);
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/treatment error:", err);
    return res.status(500).json({ error: "Failed to save treatment plan." });
  }
});

export default router;
