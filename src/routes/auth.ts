import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import db from "../lib/db";
import { signToken, getAuthUser, cookieOptions } from "../lib/auth";
import type { DbUser, SafeUser } from "../lib/types";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body;

    console.log(`[Register] Initiated registration request for email: ${email}, role: ${role}`);

    if (!name?.trim() || !email?.trim() || !password || !role) {
      console.warn(`[Register] Bad Request: Missing required fields for email: ${email}`);
      return res.status(400).json({ error: "All fields are required." });
    }
    if (password.length < 8) {
      console.warn(`[Register] Bad Request: Password too short for email: ${email}`);
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (!["patient", "therapist"].includes(role)) {
      console.warn(`[Register] Bad Request: Invalid role ${role} for email: ${email}`);
      return res.status(400).json({ error: "Invalid role." });
    }

    const emailKey = email.toLowerCase().trim();

    // Check if user exists
    console.log(`[Register] Checking database if account with email ${emailKey} already exists...`);
    const existingRes = await db.query("SELECT * FROM users WHERE email = $1", [emailKey]);
    const existing = existingRes.rows[0] as DbUser | undefined;
    
    if (existing) {
      console.warn(`[Register] Conflict: Account with email ${emailKey} already exists.`);
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const joinedDate = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    // For patients: use the therapistId sent by the client, or round-robin to the one with fewest patients
    let therapistId: string | undefined;
    if (role === "patient") {
      const requestedTherapistId = req.body.therapistId?.trim();
      if (requestedTherapistId) {
        console.log(`[Register] Validating requested therapistId: ${requestedTherapistId} for patient: ${emailKey}`);
        const foundRes = await db.query("SELECT _id FROM users WHERE _id = $1 AND role = 'therapist'", [requestedTherapistId]);
        const found = foundRes.rows[0] as DbUser | undefined;
        if (found) {
          therapistId = found._id;
          console.log(`[Register] Requested therapist valid. Patient ${emailKey} assigned to therapist ID: ${therapistId}`);
        } else {
          console.warn(`[Register] Requested therapist ID ${requestedTherapistId} not found or is not a therapist. Falling back to auto-assignment.`);
        }
      }
      if (!therapistId) {
        console.log(`[Register] Running round-robin auto-assignment for patient: ${emailKey}`);
        const therapistRes = await db.query(`
          SELECT _id FROM users
          WHERE role = 'therapist'
          ORDER BY (SELECT COUNT(*) FROM users p WHERE p.therapistId = users._id AND p.role = 'patient') ASC
          LIMIT 1
        `);
        const therapist = therapistRes.rows[0] as DbUser | undefined;
        if (therapist) {
          therapistId = therapist._id;
          console.log(`[Register] Auto-assigned patient ${emailKey} to therapist ID: ${therapistId} (fewest active patients).`);
        } else {
          console.warn(`[Register] WARNING: No therapists found in system to assign to patient ${emailKey}.`);
        }
      }
    }

    const userId = crypto.randomBytes(12).toString("hex");

    console.log(`[Register] Saving new ${role} user to Postgres database. ID: ${userId}, Email: ${emailKey}`);
    await db.query(`
      INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      userId,
      emailKey,
      passwordHash,
      name.trim(),
      role,
      therapistId || null,
      joinedDate,
      now.toISOString()
    ]);

    console.log(`[Register] SUCCESS: User registered successfully. ID: ${userId}, Email: ${emailKey}, Assigned Therapist: ${therapistId || 'none'}`);

    const token = await signToken({
      sub: userId,
      email: emailKey,
      name: name.trim(),
      role: role as "patient" | "therapist",
    });

    const safeUser: SafeUser = {
      id: userId,
      email: emailKey,
      name: name.trim(),
      role: role as "patient" | "therapist",
      joinedDate,
    };

    res.cookie("fv_token", token, cookieOptions);
    return res.status(201).json({ user: safeUser });
  } catch (err) {
    console.error(`[Register] ERROR during registration for ${req.body.email}:`, err);
    return res.status(500).json({ error: "Registration failed. Please try again." });
  }
});

// POST /api/auth/login
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const emailKey = email.toLowerCase().trim();
    const userRes = await db.query("SELECT * FROM users WHERE email = $1", [emailKey]);
    const user = userRes.rows[0] as DbUser | undefined;

    if (!user) {
      // Constant-time comparison to prevent user enumeration
      await bcrypt.hash("dummy", 12);
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash || (user as any).passwordhash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const userId = user._id!;

    const token = await signToken({
      sub: userId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    const safeUser: SafeUser = {
      id: userId,
      email: user.email,
      name: user.name,
      role: user.role,
      therapistId: user.therapistId || (user as any).therapistid || undefined,
      joinedDate: user.joinedDate || (user as any).joineddate,
    };

    res.cookie("fv_token", token, cookieOptions);
    return res.json({ user: safeUser });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Sign in failed. Please try again." });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req: Request, res: Response) => {
  res.cookie("fv_token", "", { ...cookieOptions, maxAge: 0 });
  return res.json({ ok: true });
});

// GET /api/auth/me
router.get("/me", async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) {
      return res.status(401).json({ user: null });
    }

    const userRes = await db.query("SELECT * FROM users WHERE _id = $1", [jwt.sub]);
    const user = userRes.rows[0] as DbUser | undefined;

    if (!user) {
      return res.status(401).json({ user: null });
    }

    const safeUser: SafeUser = {
      id: user._id || (user as any).id || (user as any)._id,
      email: user.email,
      name: user.name,
      role: user.role,
      therapistId: user.therapistId || (user as any).therapistid || undefined,
      joinedDate: user.joinedDate || (user as any).joineddate,
    };

    return res.json({ user: safeUser });
  } catch (err) {
    console.error("Auth/me error:", err);
    return res.status(500).json({ user: null });
  }
});

// POST /api/auth/forgot-password
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email, newPassword } = req.body;

    if (!email?.trim() || !newPassword) {
      return res.status(400).json({ error: "Email and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const emailKey = email.toLowerCase().trim();
    const userRes = await db.query("SELECT * FROM users WHERE email = $1", [emailKey]);
    const user = userRes.rows[0] as DbUser | undefined;

    if (!user) {
      return res.status(404).json({ error: "No account found with this email." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.query("UPDATE users SET passwordHash = $1 WHERE _id = $2", [passwordHash, user._id]);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Failed to reset password." });
  }
});

// GET /api/auth/therapists — public, used by registration form
router.get("/therapists", async (_req: Request, res: Response) => {
  try {
    const result = await db.query(
      "SELECT _id as id, name FROM users WHERE role = 'therapist' ORDER BY name ASC"
    );
    return res.json({ therapists: result.rows });
  } catch (err) {
    console.error("GET /api/auth/therapists error:", err);
    return res.status(500).json({ error: "Failed to fetch therapists." });
  }
});

export default router;
