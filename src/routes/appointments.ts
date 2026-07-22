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

    let appts: any[] = [];
    if (jwt.role === "patient") {
      const result = await db.query("SELECT * FROM appointments WHERE patientId = $1 ORDER BY date ASC, time ASC", [jwt.sub]);
      appts = result.rows;
    } else {
      const result = await db.query("SELECT * FROM appointments ORDER BY date ASC, time ASC");
      appts = result.rows;
    }

    console.log(`[Appointments] Query successful. Retrieved ${appts.length} appointments for ${jwt.role} ${jwt.sub}`);

    return res.json({
      appointments: appts.map((a) => ({
        id: a._id,
        patientId: a.patientId ?? a.patientid,
        therapistId: a.therapistId ?? a.therapistid,
        patientName: a.patientName ?? a.patientname,
        date: a.date,
        time: a.time,
        durationMinutes: a.durationMinutes ?? a.durationminutes,
        type: a.type,
        status: a.status,
        notes: a.notes,
        createdAt: a.createdAt ?? a.createdat,
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

    // Find this patient's therapist in Postgres
    console.log(`[Appointments] Checking assigned therapist for patient: ${jwt.sub}`);
    const userRes = await db.query("SELECT therapistId FROM users WHERE _id = $1", [jwt.sub]);
    const user = userRes.rows[0];
    let targetTherapistId = user?.therapistId ?? user?.therapistid;

    if (!targetTherapistId) {
      console.log(`[Appointments] Dynamically assigning therapist for patient: ${jwt.sub}`);
      const therapistRes = await db.query(`
        SELECT _id FROM users
        WHERE role = 'therapist'
        ORDER BY (SELECT COUNT(*) FROM users p WHERE p.therapistId = users._id AND p.role = 'patient') ASC
        LIMIT 1
      `);
      const therapist = therapistRes.rows[0];
      if (therapist) {
        targetTherapistId = therapist._id;
        await db.query("UPDATE users SET therapistId = $1 WHERE _id = $2", [targetTherapistId, jwt.sub]);
        console.log(`[Appointments] Dynamically assigned patient ${jwt.sub} to therapist ID: ${targetTherapistId}`);
      } else {
        console.warn(`[Appointments] Booking Failed: No therapists registered in system.`);
        return res.status(400).json({ error: "No therapist assigned." });
      }
    }

    const apptId = crypto.randomBytes(12).toString("hex");
    const nowStr = new Date().toISOString();

    console.log(`[Appointments] Persisting new appointment to database. Appt ID: ${apptId}, Therapist ID: ${targetTherapistId}`);
    await db.query(`
      INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
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
    ]);

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

    const result = await db.query(`
      UPDATE appointments
      SET status = $1, updatedAt = $2
      WHERE _id = $3
    `, [status, new Date().toISOString(), id]);

    if (result.rowCount === 0) {
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

    const result = await db.query("DELETE FROM appointments WHERE _id = $1", [id]);
    
    console.log(`[Appointments] SUCCESS: Deleted appointment ${id}. Rows affected: ${result.rowCount}`);
    return res.json({ ok: true });
  } catch (err) {
    console.error(`[Appointments] Error deleting appointment ${req.params.id}:`, err);
    return res.status(500).json({ error: "Failed to delete." });
  }
});

export default router;
