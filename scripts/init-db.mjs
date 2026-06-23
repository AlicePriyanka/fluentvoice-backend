/**
 * init-db.mjs
 * ============
 * Idempotent database initialization + seeding for FluentVoice.
 * Run automatically before the server starts (via package.json prestart).
 *
 * - Creates all tables if they don't exist (safe to re-run).
 * - Upserts test users so login credentials always work.
 */

import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../fluentvoice.db");

console.log(`[init-db] Connecting to SQLite at: ${dbPath}`);
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const randomId = () => crypto.randomBytes(12).toString("hex");

// ─── 1. Create tables (idempotent) ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    _id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('patient', 'therapist')),
    therapistId TEXT,
    joinedDate TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (therapistId) REFERENCES users (_id) ON DELETE SET NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    _id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('patient', 'therapist')),
    phone TEXT,
    age INTEGER,
    condition TEXT,
    bio TEXT,
    specialty TEXT,
    licenseNumber TEXT,
    clinicName TEXT,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (_id) ON DELETE CASCADE
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    _id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    fluency_score INTEGER NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('mild', 'moderate', 'severe')),
    speech_rate REAL NOT NULL,
    transcript TEXT NOT NULL,
    disfluencies TEXT NOT NULL,
    pauses INTEGER NOT NULL,
    timeline TEXT NOT NULL,
    audioUrl TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions (userId, createdAt DESC);
`);

try {
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'").get();
  if (schema && !schema.sql.includes('accepted')) {
    console.log("[init-db] Dropping old appointments table to update CHECK constraint...");
    db.exec("DROP TABLE IF EXISTS appointments;");
  }
} catch (e) {
  console.error("[init-db] Error checking/dropping old appointments table:", e);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS appointments (
    _id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    therapistId TEXT NOT NULL,
    patientName TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    durationMinutes INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('in-clinic', 'telehealth')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'confirmed', 'cancelled', 'accepted', 'rejected', 'completed')),
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (patientId) REFERENCES users (_id) ON DELETE CASCADE,
    FOREIGN KEY (therapistId) REFERENCES users (_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON appointments (patientId, date, time);
  CREATE INDEX IF NOT EXISTS idx_appointments_therapist_date ON appointments (therapistId, date, time);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS treatment_plans (
    _id TEXT PRIMARY KEY,
    patientId TEXT UNIQUE NOT NULL,
    therapistId TEXT,
    goals TEXT NOT NULL,
    exercises TEXT NOT NULL,
    remarks TEXT,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (patientId) REFERENCES users (_id) ON DELETE CASCADE,
    FOREIGN KEY (therapistId) REFERENCES users (_id) ON DELETE SET NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS treatment_plan_versions (
    _id TEXT PRIMARY KEY,
    patientId TEXT NOT NULL,
    therapistId TEXT,
    goals TEXT NOT NULL,
    exercises TEXT NOT NULL,
    remarks TEXT,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (patientId) REFERENCES users (_id) ON DELETE CASCADE,
    FOREIGN KEY (therapistId) REFERENCES users (_id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_treatment_plan_versions_patient ON treatment_plan_versions (patientId, updatedAt DESC);
`);

console.log("[init-db] ✓ All tables ensured.");

// ─── 2. Seed test users (idempotent upsert) ───────────────────────────────────
async function seedUsers() {
  const patientEmail1  = "testpatient@fluentvoice.io";
  const patientEmail2  = "janedoe@fluentvoice.io";
  const therapistEmail = "testtherapist@fluentvoice.io";

  const passwordHash = await bcrypt.hash("TestPass123", 12);
  const now = new Date();
  const joinedDate = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  // Helper: upsert user (insert if not exists, skip if already there)
  const upsertUser = db.prepare(`
    INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      passwordHash = excluded.passwordHash,
      name = excluded.name
  `);

  // Therapist
  let therapistRow = db.prepare("SELECT _id FROM users WHERE email = ?").get(therapistEmail);
  let therapistId;
  if (!therapistRow) {
    therapistId = randomId();
    upsertUser.run(therapistId, therapistEmail, passwordHash, "Dr. Test Therapist", "therapist", null, joinedDate, now.toISOString());
    console.log("[init-db] ✓ Therapist user inserted.");
  } else {
    therapistId = therapistRow._id;
    // Still update the password hash to ensure TestPass123 works
    db.prepare("UPDATE users SET passwordHash = ? WHERE email = ?").run(passwordHash, therapistEmail);
    console.log("[init-db] ✓ Therapist user already exists (password refreshed).");
  }

  // Patient 1
  let patient1Row = db.prepare("SELECT _id FROM users WHERE email = ?").get(patientEmail1);
  let patientId1;
  if (!patient1Row) {
    patientId1 = randomId();
    upsertUser.run(patientId1, patientEmail1, passwordHash, "Test Patient", "patient", therapistId, joinedDate, now.toISOString());
    console.log("[init-db] ✓ Patient 1 (Test Patient) inserted.");
  } else {
    patientId1 = patient1Row._id;
    db.prepare("UPDATE users SET passwordHash = ?, therapistId = ? WHERE email = ?").run(passwordHash, therapistId, patientEmail1);
    console.log("[init-db] ✓ Patient 1 already exists (password refreshed).");
  }

  // Patient 2
  let patient2Row = db.prepare("SELECT _id FROM users WHERE email = ?").get(patientEmail2);
  let patientId2;
  if (!patient2Row) {
    patientId2 = randomId();
    upsertUser.run(patientId2, patientEmail2, passwordHash, "Jane Doe", "patient", therapistId, joinedDate, now.toISOString());
    console.log("[init-db] ✓ Patient 2 (Jane Doe) inserted.");
  } else {
    patientId2 = patient2Row._id;
    db.prepare("UPDATE users SET passwordHash = ?, therapistId = ? WHERE email = ?").run(passwordHash, therapistId, patientEmail2);
    console.log("[init-db] ✓ Patient 2 already exists (password refreshed).");
  }

  // ── Profiles (only if missing) ──────────────────────────────────────────────
  const hasProfile = (userId) => !!db.prepare("SELECT _id FROM profiles WHERE userId = ?").get(userId);

  if (!hasProfile(therapistId)) {
    db.prepare(`
      INSERT INTO profiles (_id, userId, role, specialty, licenseNumber, clinicName, bio, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), therapistId, "therapist",
      "Stuttering and Cluttering Specialist", "SLP-2026-9988",
      "FluentVoice Clinical Center",
      "Specializing in speech fluency and anxiety-guided therapies.",
      now.toISOString());
  }

  if (!hasProfile(patientId1)) {
    db.prepare(`
      INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId1, "patient", 25, "Developmental Stuttering", "+1 (555) 019-2834", now.toISOString());
  }

  if (!hasProfile(patientId2)) {
    db.prepare(`
      INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId2, "patient", 30, "Cluttering and Rapid Speech", "+1 (555) 048-1123", now.toISOString());
  }

  // ── Appointments ─────────────────────────────────────────────────────────────
  const apptCount = db.prepare("SELECT COUNT(*) as c FROM appointments").get().c;
  if (apptCount === 0) {
    db.prepare(`
      INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId1, therapistId, "Test Patient",
      "2026-06-20", "10:00", 50, "telehealth", "confirmed",
      "Review voluntary stuttering techniques.", now.toISOString(), now.toISOString());
    db.prepare(`
      INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId2, therapistId, "Jane Doe",
      "2026-06-22", "14:00", 50, "in-clinic", "pending",
      "Initial evaluation of speed control.", now.toISOString(), now.toISOString());
    console.log("[init-db] ✓ Appointments inserted.");
  }

  // ── Treatment Plans ───────────────────────────────────────────────────────────
  const hasPlan = (patientId) => !!db.prepare("SELECT _id FROM treatment_plans WHERE patientId = ?").get(patientId);
  if (!hasPlan(patientId1)) {
    db.prepare(`
      INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId1, therapistId,
      JSON.stringify(["Reduce block frequency below 3 per minute", "Increase speech rate to 140-160 wpm"]),
      JSON.stringify(["Prolonged speech - 5 min daily", "Voluntary stuttering - 10 min per session"]),
      "Good progress overall. Fluency is improving steadily.",
      now.toISOString());
  }
  if (!hasPlan(patientId2)) {
    db.prepare(`
      INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomId(), patientId2, therapistId,
      JSON.stringify(["Reduce speaking rate to 130-150 wpm", "Improve word articulation clarity"]),
      JSON.stringify(["Syllable-timed speech drill - 10 min daily", "Structured reading with forced pauses"]),
      "Focusing on speed control. Articulation is improving.",
      now.toISOString());
  }

  console.log("[init-db] ✓ All seed data ensured.");
}

seedUsers()
  .catch((err) => {
    console.error("[init-db] ❌ Error:", err);
    process.exit(1);
  })
  .finally(() => {
    db.close();
    console.log("[init-db] ✅ Database initialization complete.");
  });
