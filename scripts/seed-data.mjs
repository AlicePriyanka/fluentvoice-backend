import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolve(__dirname, "../fluentvoice.db");

console.log(`Connecting to SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

// Enable foreign keys
db.pragma("foreign_keys = ON");

const randomId = () => crypto.randomBytes(12).toString("hex");

async function main() {
  const patientEmail1 = "testpatient@fluentvoice.io";
  const patientEmail2 = "janedoe@fluentvoice.io";
  const therapistEmail = "testtherapist@fluentvoice.io";

  // 1. Clean existing test data.
  // Cascading deletes in SQLite will automatically clean profiles, sessions, appointments, and treatment plans
  // when we delete the users.
  console.log("Cleaning old test user data...");
  db.prepare("DELETE FROM users WHERE email IN (?, ?, ?)").run(patientEmail1, patientEmail2, therapistEmail);
  console.log("✓ Old test data cleaned.");

  // Hash password
  const passwordHash = await bcrypt.hash("TestPass123", 12);
  const now = new Date();
  const joinedDate = now.toLocaleDateString("en-US", { month: "short", year: "numeric" }); // e.g. "Jun 2026"

  // 2. Insert Therapist User
  const therapistId = randomId();
  db.prepare(`
    INSERT INTO users (_id, email, passwordHash, name, role, joinedDate, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(therapistId, therapistEmail, passwordHash, "Dr. Test Therapist", "therapist", joinedDate, now.toISOString());
  console.log("✓ Therapist user inserted.");

  // 3. Insert Patients (assigned to therapist)
  const patientId1 = randomId();
  db.prepare(`
    INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(patientId1, patientEmail1, passwordHash, "Test Patient", "patient", therapistId, joinedDate, now.toISOString());

  const patientId2 = randomId();
  db.prepare(`
    INSERT INTO users (_id, email, passwordHash, name, role, therapistId, joinedDate, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(patientId2, patientEmail2, passwordHash, "Jane Doe", "patient", therapistId, joinedDate, now.toISOString());
  console.log("✓ Patient users inserted (Test Patient & Jane Doe).");

  // 4. Insert Profiles
  const therapistProfileId = randomId();
  db.prepare(`
    INSERT INTO profiles (_id, userId, role, specialty, licenseNumber, clinicName, bio, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    therapistProfileId,
    therapistId,
    "therapist",
    "Stuttering and Cluttering Specialist",
    "SLP-2026-9988",
    "FluentVoice Clinical Center",
    "Specializing in speech fluency and anxiety-guided therapies.",
    now.toISOString()
  );

  const patientProfile1Id = randomId();
  db.prepare(`
    INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientProfile1Id,
    patientId1,
    "patient",
    25,
    "Developmental Stuttering",
    "+1 (555) 019-2834",
    now.toISOString()
  );

  const patientProfile2Id = randomId();
  db.prepare(`
    INSERT INTO profiles (_id, userId, role, age, condition, phone, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    patientProfile2Id,
    patientId2,
    "patient",
    30,
    "Cluttering and Rapid Speech",
    "+1 (555) 048-1123",
    now.toISOString()
  );
  console.log("✓ User profiles inserted.");

  // 5. Insert Sessions for Patient 1 (Test Patient)
  const p1s1Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p1s1Id,
    patientId1,
    68,
    "moderate",
    132,
    "I was trying to explain the project to my manager and I felt confident at first but then I started to b-block on the word 'because' and I couldn't get past it for a few seconds.",
    JSON.stringify([
      { event: "block", time: "0:08", word: "because", duration: 2.1 },
      { event: "word_rep", time: "0:22", word: "the", duration: 0.4 },
      { event: "prolongation", time: "0:41", word: "explain", duration: 1.8 }
    ]),
    4,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
  );

  const p1s2Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p1s2Id,
    patientId1,
    72,
    "mild",
    135,
    "This is a reading sample for speech practice. I worked on my diaphragmatic breathing before starting and it seemed to help prevent major blocks. I did notice some repetitions.",
    JSON.stringify([
      { event: "repetition", time: "0:15", word: "and", duration: 0.5 },
      { event: "pause", time: "0:30", duration: 1.2 }
    ]),
    2,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()
  );

  const p1s3Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p1s3Id,
    patientId1,
    78,
    "mild",
    140,
    "Today I feel much more relaxed. The speech is flowing better. I am focusing on light articulatory contact and it feels very natural.",
    JSON.stringify([
      { event: "pause", time: "0:10", duration: 0.8 }
    ]),
    1,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString()
  );

  // 6. Insert Sessions for Patient 2 (Jane Doe)
  const p2s1Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p2s1Id,
    patientId2,
    55,
    "moderate",
    180,
    "I talk very fast when I am nervous and people tell me that I run my words together so it is hard to follow what I am saying.",
    JSON.stringify([
      { event: "word_rep", time: "0:05", word: "very", duration: 0.3 },
      { event: "phrase_rep", time: "0:12", word: "so it is", duration: 0.9 },
      { event: "interjection", time: "0:18", word: "um", duration: 0.5 }
    ]),
    5,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
  );

  const p2s2Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p2s2Id,
    patientId2,
    64,
    "moderate",
    165,
    "Trying to slow down my speaking rate. I am focusing on pausing at commas and full stops to give myself time to formulate the next sentence.",
    JSON.stringify([
      { event: "pause", time: "0:08", duration: 1.1 },
      { event: "word_rep", time: "0:20", word: "and", duration: 0.4 }
    ]),
    3,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString()
  );

  const p2s3Id = randomId();
  db.prepare(`
    INSERT INTO sessions (_id, userId, fluency_score, severity, speech_rate, transcript, disfluencies, pauses, timeline, audioUrl, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p2s3Id,
    patientId2,
    75,
    "mild",
    150,
    "Speaking in public was easier today. I used pausing techniques and kept my speed controlled throughout the conversation.",
    JSON.stringify([
      { event: "pause", time: "0:15", duration: 0.6 }
    ]),
    2,
    JSON.stringify([]),
    "",
    new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
  );
  console.log("✓ Patient sessions inserted.");

  // 7. Insert Treatment Plans
  const treatmentPlan1Id = randomId();
  db.prepare(`
    INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    treatmentPlan1Id,
    patientId1,
    therapistId,
    JSON.stringify([
      "Reduce block frequency below 3 per minute",
      "Increase speech rate to 140-160 wpm",
      "Build confidence in group conversation settings"
    ]),
    JSON.stringify([
      "Prolonged speech - 5 min daily reading aloud",
      "Voluntary stuttering - 10 min per session",
      "Diaphragmatic breathing exercises - 3x/day"
    ]),
    "Good progress overall. Fluency is improving steadily. Patient is highly cooperative and motivated.",
    now.toISOString()
  );

  const treatmentPlan2Id = randomId();
  db.prepare(`
    INSERT INTO treatment_plans (_id, patientId, therapistId, goals, exercises, remarks, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    treatmentPlan2Id,
    patientId2,
    therapistId,
    JSON.stringify([
      "Reduce speaking rate to 130-150 wpm",
      "Increase use of pausing at syntactic boundaries",
      "Improve word articulation clarity"
    ]),
    JSON.stringify([
      "Syllable-timed speech drill - 10 min daily",
      "Structured reading aloud with forced pauses - 15 min daily",
      "Speed tracking exercises"
    ]),
    "Focusing on speed control. Speech rate is gradually stabilizing. Articulation is improving.",
    now.toISOString()
  );
  console.log("✓ Patient treatment plans inserted.");

  // 8. Insert Appointments
  const appointment1Id = randomId();
  db.prepare(`
    INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    appointment1Id,
    patientId1,
    therapistId,
    "Test Patient",
    "2026-06-20",
    "10:00",
    50,
    "telehealth",
    "confirmed",
    "Review voluntary stuttering techniques and progress log.",
    now.toISOString(),
    now.toISOString()
  );

  const appointment2Id = randomId();
  db.prepare(`
    INSERT INTO appointments (_id, patientId, therapistId, patientName, date, time, durationMinutes, type, status, notes, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    appointment2Id,
    patientId2,
    therapistId,
    "Jane Doe",
    "2026-06-22",
    "14:00",
    50,
    "in-clinic",
    "pending",
    "Initial evaluation of speed control exercises and pacing.",
    now.toISOString(),
    now.toISOString()
  );
  console.log("✓ Appointments inserted.");

  console.log("\n🎉 Seeding complete! SQLite database is populated with fresh test data.");
}

main()
  .catch((err) => {
    console.error("❌ Error seeding database:", err);
    process.exit(1);
  })
  .finally(() => {
    db.close();
  });
