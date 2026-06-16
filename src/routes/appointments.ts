import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/appointments
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    // Fetch appointments from SQLite based on role
    const appts = jwt.role === "patient"
      ? db.prepare("SELECT * FROM appointments WHERE patientId = ? ORDER BY date ASC, time ASC").all(jwt.sub) as any[]
      : db.prepare("SELECT * FROM appointments WHERE therapistId = ? ORDER BY date ASC, time ASC").all(jwt.sub) as any[];

    return res.json({
      appointments: appts.map((a) => ({
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
      })),
    });
  } catch (err) {
    console.error("GET /api/appointments error:", err);
    return res.status(500).json({ error: "Failed to fetch appointments." });
  }
});

// POST /api/appointments
router.post("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });
    if (jwt.role !== "patient") return res.status(403).json({ error: "Only patients can book." });

    const { date, time, type, notes } = req.body;
    if (!date || !time) return res.status(400).json({ error: "Date and time are required." });

    // Find this patient's therapist in SQLite
    const user = db.prepare("SELECT therapistId FROM users WHERE _id = ?").get(jwt.sub) as any;
    if (!user?.therapistId) return res.status(400).json({ error: "No therapist assigned." });

    const apptId = crypto.randomBytes(12).toString("hex");
    const nowStr = new Date().toISOString();

    db.prepare(`
      INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apptId,
      jwt.sub,
      user.therapistId,
      jwt.name,
      date,
      time,
      50,
      type ?? "in-clinic",
      "pending",
      notes ?? "",
      nowStr,
      nowStr
    );

    return res.status(201).json({ id: apptId });
  } catch (err) {
    console.error("POST /api/appointments error:", err);
    return res.status(500).json({ error: "Failed to book appointment." });
  }
});

// PUT /api/appointments/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { status } = req.body;

    if (!["confirmed", "cancelled", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }

    const result = db.prepare(`
      UPDATE appointments
      SET status = ?, updatedAt = ?
      WHERE _id = ?
    `).run(status, new Date().toISOString(), id);

    if (result.changes === 0) {
      return res.status(404).json({ error: "Appointment not found." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/appointments/:id error:", err);
    return res.status(500).json({ error: "Failed to update appointment." });
  }
});

// DELETE /api/appointments/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    db.prepare("DELETE FROM appointments WHERE _id = ?").run(id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/appointments/:id error:", err);
    return res.status(500).json({ error: "Failed to delete." });
  }
});

export default router;
