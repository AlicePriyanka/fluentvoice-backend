import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

console.log(`[init-db] Connecting to Postgres at: ${process.env.DATABASE_URL}`);
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});

const randomId = () => crypto.randomBytes(12).toString("hex");

// ─── 1. Create tables (idempotent) ────────────────────────────────────────────
async function ensureTables() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
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

    await client.query(`
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

    await client.query(`
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions (userId, createdAt DESC);`);

    await client.query(`
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON appointments (patientId, date, time);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_therapist_date ON appointments (therapistId, date, time);`);

    await client.query(`
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

    await client.query(`
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
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plan_versions_patient ON treatment_plan_versions (patientId, updatedAt DESC);`);

    await client.query("COMMIT");
    console.log("[init-db] ✓ All tables ensured.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ─── 2. Seed test users (idempotent upsert) ───────────────────────────────────
async function seedUsers() {
  const patientEmail1  = "testpatient@fluentvoice.io";
  const patientEmail2  = "janedoe@fluentvoice.io";
  const therapistEmail = "testtherapist@fluentvoice.io";

  const passwordHash = await bcrypt.hash("TestPass123", 12);
  const now = new Date();
  const joinedDate = now.toLocaleDateString("en-US", { month: "short", year: "numeric" });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    
    const upsertUser = async (id, email, passwordHash, name, role, therapistId, joinedDate, createdAt) => {
      await client.query(`
        INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(email) DO UPDATE SET
          passwordHash = EXCLUDED.passwordHash,
          name = EXCLUDED.name
      `, [id, email, passwordHash, name, role, therapistId, joinedDate, createdAt]);
    };

    // Therapist
    let therapistRowRes = await client.query("SELECT _id FROM users WHERE email = $1", [therapistEmail]);
    let therapistId;
    if (therapistRowRes.rowCount === 0) {
      therapistId = randomId();
      await upsertUser(therapistId, therapistEmail, passwordHash, "Dr. Test Therapist", "therapist", null, joinedDate, now.toISOString());
      console.log("[init-db] ✓ Therapist user inserted.");
    } else {
      therapistId = therapistRowRes.rows[0]._id;
      await client.query("UPDATE users SET passwordHash = $1 WHERE email = $2", [passwordHash, therapistEmail]);
      console.log("[init-db] ✓ Therapist user already exists (password refreshed).");
    }

    // Patient 1
    let patient1RowRes = await client.query("SELECT _id FROM users WHERE email = $1", [patientEmail1]);
    let patientId1;
    if (patient1RowRes.rowCount === 0) {
      patientId1 = randomId();
      await upsertUser(patientId1, patientEmail1, passwordHash, "Test Patient", "patient", therapistId, joinedDate, now.toISOString());
      console.log("[init-db] ✓ Patient 1 (Test Patient) inserted.");
    } else {
      patientId1 = patient1RowRes.rows[0]._id;
      await client.query("UPDATE users SET passwordHash = $1, therapistId = $2 WHERE email = $3", [passwordHash, therapistId, patientEmail1]);
      console.log("[init-db] ✓ Patient 1 already exists (password refreshed).");
    }

    // Patient 2
    let patient2RowRes = await client.query("SELECT _id FROM users WHERE email = $1", [patientEmail2]);
    let patientId2;
    if (patient2RowRes.rowCount === 0) {
      patientId2 = randomId();
      await upsertUser(patientId2, patientEmail2, passwordHash, "Jane Doe", "patient", therapistId, joinedDate, now.toISOString());
      console.log("[init-db] ✓ Patient 2 (Jane Doe) inserted.");
    } else {
      patientId2 = patient2RowRes.rows[0]._id;
      await client.query("UPDATE users SET passwordHash = $1, therapistId = $2 WHERE email = $3", [passwordHash, therapistId, patientEmail2]);
      console.log("[init-db] ✓ Patient 2 already exists (password refreshed).");
    }

    // Profiles
    const hasProfile = async (userId) => {
      const res = await client.query("SELECT _id FROM profiles WHERE userId = $1", [userId]);
      return res.rowCount > 0;
    };

    if (!(await hasProfile(therapistId))) {
      await client.query(`
        INSERT INTO profiles (_id, userId, role, specialty, licenseNumber, clinicName, bio, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [randomId(), therapistId, "therapist", "Stuttering and Cluttering Specialist", "SLP-2026-9988", "FluentVoice Clinical Center", "Specializing in speech fluency and anxiety-guided therapies.", now.toISOString()]);
    }

    if (!(await hasProfile(patientId1))) {
      await client.query(`
        INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomId(), patientId1, "patient", 25, "Developmental Stuttering", "+1 (555) 019-2834", now.toISOString()]);
    }

    if (!(await hasProfile(patientId2))) {
      await client.query(`
        INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomId(), patientId2, "patient", 30, "Cluttering and Rapid Speech", "+1 (555) 048-1123", now.toISOString()]);
    }

    // Appointments
    const apptCountRes = await client.query("SELECT COUNT(*) as c FROM appointments");
    const apptCount = parseInt(apptCountRes.rows[0].c);
    if (apptCount === 0) {
      await client.query(`
        INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [randomId(), patientId1, therapistId, "Test Patient", "2026-06-20", "10:00", 50, "telehealth", "confirmed", "Review voluntary stuttering techniques.", now.toISOString(), now.toISOString()]);
      await client.query(`
        INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [randomId(), patientId2, therapistId, "Jane Doe", "2026-06-22", "14:00", 50, "in-clinic", "pending", "Initial evaluation of speed control.", now.toISOString(), now.toISOString()]);
      console.log("[init-db] ✓ Appointments inserted.");
    }

    // Treatment Plans
    const hasPlan = async (patientId) => {
      const res = await client.query("SELECT _id FROM treatment_plans WHERE patientId = $1", [patientId]);
      return res.rowCount > 0;
    };
    if (!(await hasPlan(patientId1))) {
      await client.query(`
        INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomId(), patientId1, therapistId, JSON.stringify(["Reduce block frequency below 3 per minute", "Increase speech rate to 140-160 wpm"]), JSON.stringify(["Prolonged speech - 5 min daily", "Voluntary stuttering - 10 min per session"]), "Good progress overall. Fluency is improving steadily.", now.toISOString()]);
    }
    if (!(await hasPlan(patientId2))) {
      await client.query(`
        INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [randomId(), patientId2, therapistId, JSON.stringify(["Reduce speaking rate to 130-150 wpm", "Improve word articulation clarity"]), JSON.stringify(["Syllable-timed speech drill - 10 min daily", "Structured reading with forced pauses"]), "Focusing on speed control. Articulation is improving.", now.toISOString()]);
    }

    await client.query("COMMIT");
    console.log("[init-db] ✓ All seed data ensured.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function run() {
  try {
    await ensureTables();
    await seedUsers();
  } catch (err) {
    console.error("[init-db] ❌ Error:", err);
    process.exit(1);
  } finally {
    await db.end();
    console.log("[init-db] ✅ Database initialization complete.");
  }
}

run();
