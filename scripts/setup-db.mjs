/**
 * Creates PostgreSQL tables and indexes for FluentVoice.
 * Run once: node scripts/setup-db.mjs
 */
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

console.log(`Initializing PostgreSQL database...`);

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false }
});
// 
async function setup() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // 1. Create users table
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
    console.log("✓ Created 'users' table");

    // 2. Create profiles table
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
    console.log("✓ Created 'profiles' table");

    // 3. Create sessions table
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
    console.log("✓ Created 'sessions' table");

    // Create compound index for sessions
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_created 
      ON sessions (userId, createdAt DESC);
    `);
    console.log("✓ Created index on sessions(userId, createdAt)");

    // 4. Create appointments table
    // PostgreSQL doesn't allow dropping constraints easily with IF EXISTS if you want to alter table without knowing constraint name.
    // We'll just create the table. If it already exists and needs an update, the user will have to DROP it manually.
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
    console.log("✓ Created 'appointments' table");

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_patient_date 
      ON appointments (patientId, date, time);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_appointments_therapist_date 
      ON appointments (therapistId, date, time);
    `);
    console.log("✓ Created indexes on appointments");

    // 5. Create treatment_plans table
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
    console.log("✓ Created 'treatment_plans' table");

    // 6. Create treatment_plan_versions table
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
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_treatment_plan_versions_patient 
      ON treatment_plan_versions (patientId, updatedAt DESC);
    `);
    console.log("✓ Created 'treatment_plan_versions' table");

    await client.query("COMMIT");
    console.log("\\n✅ PostgreSQL Database tables and indexes initialized successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error setting up PostgreSQL database:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

setup();
