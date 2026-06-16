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

    if (!name?.trim() || !email?.trim() || !password || !role) {
      return res.status(400).json({ error: "All fields are required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }
    if (!["patient", "therapist"].includes(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const emailKey = email.toLowerCase().trim();

    // Check if user exists
    const existing = db.prepare("SELECT * FROM users WHERE email = ?").get(emailKey) as DbUser | undefined;
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    const joinedDate = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });

    // For patients: auto-assign to the first therapist in the system
    let therapistId: string | undefined;
    if (role === "patient") {
      const therapist = db.prepare("SELECT * FROM users WHERE role = 'therapist' LIMIT 1").get() as DbUser | undefined;
      if (therapist) therapistId = therapist._id;
    }

    const userId = crypto.randomBytes(12).toString("hex");

    db.prepare(`
      INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      emailKey,
      passwordHash,
      name.trim(),
      role,
      therapistId || null,
      joinedDate,
      now.toISOString()
    );

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
    console.error("Register error:", err);
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
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(emailKey) as DbUser | undefined;

    if (!user) {
      // Constant-time comparison to prevent user enumeration
      await bcrypt.hash("dummy", 12);
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
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
      therapistId: user.therapistId || undefined,
      joinedDate: user.joinedDate,
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

    const user = db.prepare("SELECT * FROM users WHERE _id = ?").get(jwt.sub) as DbUser | undefined;

    if (!user) {
      return res.status(401).json({ user: null });
    }

    const safeUser: SafeUser = {
      id: user._id!,
      email: user.email,
      name: user.name,
      role: user.role,
      therapistId: user.therapistId || undefined,
      joinedDate: user.joinedDate,
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
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(emailKey) as DbUser | undefined;

    if (!user) {
      return res.status(404).json({ error: "No account found with this email." });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET passwordHash = ? WHERE _id = ?").run(passwordHash, user._id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Forgot password error:", err);
    return res.status(500).json({ error: "Failed to reset password." });
  }
});

export default router;
