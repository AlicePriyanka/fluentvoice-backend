import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/appointments
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Appointments] Unauthorized GET list request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    console.log(`[Appointments] GET list initiated by User: ${jwt.sub} (role: ${jwt.role})`);

    // Fetch appointments from SQLite based on role
    const appts = jwt.role === "patient"
      ? db.prepare("SELECT * FROM appointments WHERE patientId = ? ORDER BY date ASC, time ASC").all(jwt.sub) as any[]
      : db.prepare("SELECT * FROM appointments ORDER BY date ASC, time ASC").all() as any[];

    console.log(`[Appointments] Query successful. Retrieved ${appts.length} appointments for ${jwt.role} ${jwt.sub}`);

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
    console.error("[Appointments] Error fetching appointments list:", err);
    return res.status(500).json({ error: "Failed to fetch appointments." });
  }
});

// POST /api/appointments
router.post("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Appointments] Unauthorized POST book request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }
    if (jwt.role !== "patient") {
      console.warn(`[Appointments] Forbidden POST request. User ${jwt.sub} is role ${jwt.role}, only patients can book.`);
      return res.status(403).json({ error: "Only patients can book." });
    }

    const { date, time, type, notes } = req.body;
    console.log(`[Appointments] Booking attempt by patient: ${jwt.sub} (${jwt.name}) for Date: ${date}, Time: ${time}, Type: ${type}`);

    if (!date || !time) {
      console.warn("[Appointments] Bad Request: Missing date or time");
      return res.status(400).json({ error: "Date and time are required." });
    }

    // Find this patient's therapist in SQLite
    console.log(`[Appointments] Checking assigned therapist for patient: ${jwt.sub}`);
    const user = db.prepare("SELECT therapistId FROM users WHERE _id = ?").get(jwt.sub) as any;
    let targetTherapistId = user?.therapistId;
    if (!targetTherapistId) {
      console.log(`[Appointments] Dynamically assigning therapist for patient: ${jwt.sub}`);
      const therapist = db.prepare(`
        SELECT _id FROM users
        WHERE role = 'therapist'
        ORDER BY (SELECT COUNT(*) FROM users p WHERE p.therapistId = users._id AND p.role = 'patient') ASC
        LIMIT 1
      `).get() as any;
      if (therapist) {
        targetTherapistId = therapist._id;
        db.prepare("UPDATE users SET therapistId = ? WHERE _id = ?").run(targetTherapistId, jwt.sub);
        console.log(`[Appointments] Dynamically assigned patient ${jwt.sub} to therapist ID: ${targetTherapistId}`);
      } else {
        console.warn(`[Appointments] Booking Failed: No therapists registered in system.`);
        return res.status(400).json({ error: "No therapist assigned." });
      }
    }

    const apptId = crypto.randomBytes(12).toString("hex");
    const nowStr = new Date().toISOString();

    console.log(`[Appointments] Persisting new appointment to database. Appt ID: ${apptId}, Therapist ID: ${targetTherapistId}`);
    db.prepare(`
      INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      apptId,
      jwt.sub,
      targetTherapistId,
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

    console.log(`[Appointments] SUCCESS: Appointment ${apptId} created successfully in status: pending`);
    return res.status(201).json({ id: apptId });
  } catch (err) {
    console.error("[Appointments] Error booking appointment:", err);
    return res.status(500).json({ error: "Failed to book appointment." });
  }
});

// PUT /api/appointments/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Appointments] Unauthorized PUT update request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const { status } = req.body;

    console.log(`[Appointments] PUT update request received for ID: ${id} by User: ${jwt.sub} (${jwt.role}), target status: ${status}`);

    if (!["confirmed", "cancelled", "pending", "accepted", "rejected", "completed"].includes(status)) {
      console.warn(`[Appointments] Bad Request: Invalid status value: ${status}`);
      return res.status(400).json({ error: "Invalid status." });
    }

    const result = db.prepare(`
      UPDATE appointments
      SET status = ?, updatedAt = ?
      WHERE _id = ?
    `).run(status, new Date().toISOString(), id);

    if (result.changes === 0) {
      console.warn(`[Appointments] Not Found: Update failed because appointment ID ${id} was not found.`);
      return res.status(404).json({ error: "Appointment not found." });
    }

    console.log(`[Appointments] SUCCESS: Updated status of appointment ${id} to: ${status}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(`[Appointments] Error updating status for appointment ${req.params.id}:`, err);
    return res.status(500).json({ error: "Failed to update appointment." });
  }
});

// DELETE /api/appointments/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      console.warn("[Appointments] Unauthorized DELETE request (missing/invalid token)");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    console.log(`[Appointments] DELETE request received for ID: ${id} by User: ${jwt.sub}`);

    const result = db.prepare("DELETE FROM appointments WHERE _id = ?").run(id);
    
    console.log(`[Appointments] SUCCESS: Deleted appointment ${id}. Rows affected: ${result.changes}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(`[Appointments] Error deleting appointment ${req.params.id}:`, err);
    return res.status(500).json({ error: "Failed to delete." });
  }
});

export default router;
