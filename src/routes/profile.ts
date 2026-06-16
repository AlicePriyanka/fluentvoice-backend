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

    // Get base user info from SQLite (excluding passwordHash)
    const user = db.prepare(
      "SELECT _id, name, email, role, joinedDate FROM users WHERE _id = ?"
    ).get(jwt.sub) as any;

    if (!user) return res.status(404).json({ error: "User not found" });

    // Get extended profile
    const profile = db.prepare(
      "SELECT * FROM profiles WHERE userId = ?"
    ).get(jwt.sub) as any;

    // Get session stats using SQL aggregate functions
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as count, 
        AVG(fluency_score) as avgFluency, 
        MAX(createdAt) as lastSession
      FROM sessions
      WHERE userId = ?
    `).get(jwt.sub) as any;

    const count = stats?.count ?? 0;
    const avgFluency = stats?.avgFluency ? Math.round(stats.avgFluency) : 0;
    const lastSession = stats?.lastSession ?? null;

    return res.json({
      profile: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        joinedDate: user.joinedDate ?? "—",
        phone: profile?.phone ?? "",
        age: profile?.age ?? null,
        condition: profile?.condition ?? "",
        bio: profile?.bio ?? "",
        specialty: profile?.specialty ?? "",
        licenseNumber: profile?.licenseNumber ?? "",
        clinicName: profile?.clinicName ?? "",
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
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const body = req.body;
    db.transaction(() => {
      // Update display name on user doc
      if (body.name?.trim()) {
        db.prepare("UPDATE users SET name = ? WHERE _id = ?").run(
          body.name.trim(),
          jwt.sub
        );
      }

      // Upsert extended profile
      const existing = db.prepare("SELECT * FROM profiles WHERE userId = ?").get(jwt.sub) as any;

      const updatedFields = {
        phone: body.phone !== undefined ? body.phone : (existing?.phone ?? null),
        age: body.age !== undefined ? (body.age ? Number(body.age) : null) : (existing?.age ?? null),
        condition: body.condition !== undefined ? body.condition : (existing?.condition ?? null),
        bio: body.bio !== undefined ? body.bio : (existing?.bio ?? null),
        specialty: body.specialty !== undefined ? body.specialty : (existing?.specialty ?? null),
        licenseNumber: body.licenseNumber !== undefined ? body.licenseNumber : (existing?.licenseNumber ?? null),
        clinicName: body.clinicName !== undefined ? body.clinicName : (existing?.clinicName ?? null),
      };

      if (existing) {
        db.prepare(`
          UPDATE profiles
          SET role = ?, phone = ?, age = ?, condition = ?, bio = ?, specialty = ?, licenseNumber = ?, clinicName = ?, updatedAt = ?
          WHERE userId = ?
        `).run(
          jwt.role,
          updatedFields.phone,
          updatedFields.age,
          updatedFields.condition,
          updatedFields.bio,
          updatedFields.specialty,
          updatedFields.licenseNumber,
          updatedFields.clinicName,
          new Date().toISOString(),
          jwt.sub
        );
      } else {
        const profileId = crypto.randomBytes(12).toString("hex");
        db.prepare(`
          INSERT INTO profiles (_id, userId, role, phone, age, condition, bio, specialty, licenseNumber, clinicName, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
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
          new Date().toISOString()
        );
      }
    })();

    return res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/profile error:", err);
    return res.status(500).json({ error: "Failed to update profile." });
  }
});

export default router;
