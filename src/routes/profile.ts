import { Router, Request, Response } from "express";
import crypto from "crypto";
import db from "../lib/db";
import { getAuthUser } from "../lib/auth";

const router = Router();

// GET /api/profile
router.get("/", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    // Get base user info from Postgres (excluding passwordHash)
    const userRes = await db.query(
      "SELECT _id, name, email, role, therapistId, joinedDate FROM users WHERE _id = $1",
      [jwt.sub]
    );
    const user = userRes.rows[0] as any;

    if (!user) return res.status(404).json({ error: "User not found" });

    // Get extended profile
    const profileRes = await db.query(
      "SELECT * FROM profiles WHERE userId = $1",
      [jwt.sub]
    );
    const profile = profileRes.rows[0] as any;

    // Fetch assigned therapist if user is a patient and has therapistId
    let assignedTherapist = null;
    const tId = user.therapistid ?? user.therapistId;
    if (user.role === "patient" && tId) {
      const therapistRes = await db.query(`
        SELECT 
          u._id as id, 
          u.name, 
          p.qualification, 
          p.experience, 
          p.specialty, 
          p.bio
        FROM users u
        LEFT JOIN profiles p ON u._id = p.userId
        WHERE u._id = $1 AND u.role = 'therapist'
      `, [tId]);
      const t = therapistRes.rows[0] as any;
      if (t) {
        assignedTherapist = {
          id: t.id,
          name: t.name,
          qualification: t.qualification ?? "",
          experience: t.experience ?? "",
          specialty: t.specialty ?? "",
          bio: t.bio ?? "",
        };
      }
    }

    // Get session stats using SQL aggregate functions
    const statsRes = await db.query(`
      SELECT 
        COUNT(*) as count, 
        AVG(fluency_score) as avgFluency, 
        MAX(createdAt) as lastSession
      FROM sessions
      WHERE userId = $1
    `, [jwt.sub]);
    const stats = statsRes.rows[0] as any;

    const count = stats?.count ? parseInt(stats.count) : 0;
    const avgFluency = stats?.avgfluency ? Math.round(Number(stats.avgfluency)) : 0;
    const lastSession = stats?.lastsession ?? null;

    return res.json({
      profile: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        joinedDate: user.joineddate ?? user.joinedDate ?? "—",
        phone: profile?.phone ?? "",
        age: profile?.age ?? null,
        condition: profile?.condition ?? "",
        bio: profile?.bio ?? "",
        specialty: profile?.specialty ?? "",
        licenseNumber: profile?.licensenumber ?? profile?.licenseNumber ?? "",
        clinicName: profile?.clinicname ?? profile?.clinicName ?? "",
        qualification: profile?.qualification ?? "",
        experience: profile?.experience ?? "",
        assignedTherapist,
        stats: {
          sessionsCount: count,
          avgFluency: avgFluency,
          lastSession: lastSession,
        },
      },
    });
  } catch (err) {
    console.error("GET /api/profile error:", err);
    return res.status(500).json({ error: "Failed to fetch profile." });
  }
});

// PUT /api/profile
router.put("/", async (req: Request, res: Response) => {
  const client = await db.connect();
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      client.release();
      return res.status(401).json({ error: "Unauthorized" });
    }

    const body = req.body;
    
    await client.query("BEGIN");
    
    // Update display name on user doc
    if (body.name?.trim()) {
      await client.query("UPDATE users SET name = $1 WHERE _id = $2", [
        body.name.trim(),
        jwt.sub
      ]);
    }

    // Upsert extended profile
    const existingRes = await client.query("SELECT * FROM profiles WHERE userId = $1", [jwt.sub]);
    const existing = existingRes.rows[0] as any;

    const updatedFields = {
      phone: body.phone !== undefined ? body.phone : (existing?.phone ?? null),
      age: body.age !== undefined ? (body.age ? Number(body.age) : null) : (existing?.age ?? null),
      condition: body.condition !== undefined ? body.condition : (existing?.condition ?? null),
      bio: body.bio !== undefined ? body.bio : (existing?.bio ?? null),
      specialty: body.specialty !== undefined ? body.specialty : (existing?.specialty ?? null),
      licenseNumber: body.licenseNumber !== undefined ? body.licenseNumber : (existing?.licensenumber ?? existing?.licenseNumber ?? null),
      clinicName: body.clinicName !== undefined ? body.clinicName : (existing?.clinicname ?? existing?.clinicName ?? null),
      qualification: body.qualification !== undefined ? body.qualification : (existing?.qualification ?? null),
      experience: body.experience !== undefined ? body.experience : (existing?.experience ?? null),
    };

    if (existing) {
      await client.query(`
        UPDATE profiles
        SET role = $1, phone = $2, age = $3, condition = $4, bio = $5, specialty = $6, licenseNumber = $7, clinicName = $8, qualification = $9, experience = $10, updatedAt = $11
        WHERE userId = $12
      `, [
        jwt.role,
        updatedFields.phone,
        updatedFields.age,
        updatedFields.condition,
        updatedFields.bio,
        updatedFields.specialty,
        updatedFields.licenseNumber,
        updatedFields.clinicName,
        updatedFields.qualification,
        updatedFields.experience,
        new Date().toISOString(),
        jwt.sub
      ]);
    } else {
      const profileId = crypto.randomBytes(12).toString("hex");
      await client.query(`
        INSERT INTO profiles (_id, userId, role, phone, age, condition, bio, specialty, licenseNumber, clinicName, qualification, experience, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        profileId,
        jwt.sub,
        jwt.role,
        updatedFields.phone,
        updatedFields.age,
        updatedFields.condition,
        updatedFields.bio,
        updatedFields.specialty,
        updatedFields.licenseNumber,
        updatedFields.clinicName,
        updatedFields.qualification,
        updatedFields.experience,
        new Date().toISOString()
      ]);
    }
    
    await client.query("COMMIT");
    client.release();

    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    client.release();
    console.error("PUT /api/profile error:", err);
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

export default router;
