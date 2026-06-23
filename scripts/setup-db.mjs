/**
 * Creates SQLite tables and indexes for FluentVoice.
 * Run once: node scripts/setup-db.mjs
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../fluentvoice.db");

console.log(`Initializing SQLite database at: ${dbPath}`);

const db = new Database(dbPath);

// Enable foreign keys
db.pragma("foreign_keys = ON");

try {
  // 1. Create users table
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
  console.log("✓ Created 'users' table");

  // 2. Create profiles table
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
  console.log("✓ Created 'profiles' table");

  // 3. Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      _id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      fluency_score INTEGER NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('mild', 'moderate', 'severe')),
      speech_rate REAL NOT NULL,
      transcript TEXT NOT NULL,
      disfluencies TEXT NOT NULL, -- Serialized JSON array
      pauses INTEGER NOT NULL,
      timeline TEXT NOT NULL, -- Serialized JSON array
      audioUrl TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users (_id) ON DELETE CASCADE
    );
  `);
  console.log("✓ Created 'sessions' table");

  // Create compound index for sessions
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user_created 
    ON sessions (userId, createdAt DESC);
  `);
  console.log("✓ Created index on sessions(userId, createdAt)");

  // 4. Create appointments table
  try {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='appointments'").get();
    if (schema && !schema.sql.includes('accepted')) {
      console.log("[setup-db] Dropping old appointments table to update CHECK constraint...");
      db.exec("DROP TABLE IF EXISTS appointments;");
    }
  } catch (e) {
    console.error("[setup-db] Error checking/dropping old appointments table:", e);
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
  `);
  console.log("✓ Created 'appointments' table");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_appointments_patient_date 
    ON appointments (patientId, date, time);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_appointments_therapist_date 
    ON appointments (therapistId, date, time);
  `);
  console.log("✓ Created indexes on appointments");

  // 5. Create treatment_plans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS treatment_plans (
      _id TEXT PRIMARY KEY,
      patientId TEXT UNIQUE NOT NULL,
      therapistId TEXT,
      goals TEXT NOT NULL, -- Serialized JSON array
      exercises TEXT NOT NULL, -- Serialized JSON array
      remarks TEXT,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (patientId) REFERENCES users (_id) ON DELETE CASCADE,
      FOREIGN KEY (therapistId) REFERENCES users (_id) ON DELETE SET NULL
    );
  `);
  console.log("✓ Created 'treatment_plans' table");

  // 6. Create treatment_plan_versions table
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
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_treatment_plan_versions_patient 
    ON treatment_plan_versions (patientId, updatedAt DESC);
  `);
  console.log("✓ Created 'treatment_plan_versions' table");

  console.log("\n✅ SQLite Database tables and indexes initialized successfully.");
} catch (err) {
  console.error("❌ Error setting up SQLite database:", err.message);
  process.exit(1);
} finally {
  db.close();
}
