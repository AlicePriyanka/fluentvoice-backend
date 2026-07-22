import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../fluentvoice.db");
console.log("Connecting to SQLite at:", dbPath);
const db = new Database(dbPath);

console.log("\n--- TABLE RECORD COUNTS ---");
const tables = ["users", "profiles", "sessions", "appointments", "treatment_plans"];
for (const table of tables) {
  try {
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get();
    console.log(`${table}: ${row.cnt} records`);
  } catch (err) {
    console.error(`Error counting ${table}:`, err.message);
  }
}

console.log("\n--- LIST OF USERS ---");
try {
  const users = db.prepare("SELECT _id, email, name, role, therapistId FROM users").all();
  console.table(users);
} catch (err) {
  console.error("Error fetching users:", err.message);
}

console.log("\n--- LIST OF APPOINTMENTS ---");
try {
  const appts = db.prepare("SELECT _id, patientId, therapistId, patientName, date, time, status FROM appointments").all();
  console.table(appts);
} catch (err) {
  console.error("Error fetching appointments:", err.message);
}

console.log("\n--- LIST OF TREATMENT PLANS ---");
try {
  const plans = db.prepare("SELECT _id, patientId, therapistId, goals, exercises, remarks FROM treatment_plans").all();
  console.table(plans);
} catch (err) {
  console.error("Error fetching treatment plans:", err.message);
}

console.log("\n--- INTEGRITY CHECKS ---");
// Check for patients without a therapist
try {
  const noTherapist = db.prepare("SELECT email, name FROM users WHERE role = 'patient' AND (therapistId IS NULL OR therapistId = '')").all();
  if (noTherapist.length > 0) {
    console.log("WARNING: Found patients with no assigned therapist:", noTherapist);
  } else {
    console.log("OK: All patients have an assigned therapist.");
  }
} catch (err) {
  console.error("Error checking patients therapistId:", err.message);
}

// Check for invalid therapistIds in users
try {
  const invalidTherapists = db.prepare("SELECT email, name, therapistId FROM users WHERE role = 'patient' AND therapistId NOT IN (SELECT _id FROM users WHERE role = 'therapist')").all();
  if (invalidTherapists.length > 0) {
    console.log("WARNING: Found patients assigned to non-existent therapists:", invalidTherapists);
  } else {
    console.log("OK: All patient therapistId values point to valid therapists.");
  }
} catch (err) {
  console.error("Error checking patient therapist references:", err.message);
}

// Check for invalid patientIds in appointments
try {
  const invalidPatientAppts = db.prepare("SELECT _id, patientName FROM appointments WHERE patientId NOT IN (SELECT _id FROM users WHERE role = 'patient')").all();
  if (invalidPatientAppts.length > 0) {
    console.log("WARNING: Found appointments with invalid patientId:", invalidPatientAppts);
  } else {
    console.log("OK: All appointments reference valid patients.");
  }
} catch (err) {
  console.error("Error checking appointments patientId:", err.message);
}

// Check for invalid therapistIds in appointments
try {
  const invalidTherapistAppts = db.prepare("SELECT _id, patientName FROM appointments WHERE therapistId NOT IN (SELECT _id FROM users WHERE role = 'therapist')").all();
  if (invalidTherapistAppts.length > 0) {
    console.log("WARNING: Found appointments with invalid therapistId:", invalidTherapistAppts);
  } else {
    console.log("OK: All appointments reference valid therapists.");
  }
} catch (err) {
  console.error("Error checking appointments therapistId:", err.message);
}

db.close();
console.log("\nDone checking.");
