const BASE_URL = "http://localhost:5001";

async function runTests() {
  console.log("=== STARTING INTEGRATION FLOWS TEST ===");

  // Helper to parse cookies from response headers
  function getCookie(headers) {
    const setCookie = headers.get("set-cookie");
    if (!setCookie) return null;
    const match = setCookie.match(/fv_token=([^;]+)/);
    return match ? match[1] : null;
  }

  // 1. Log in as therapist
  console.log("\n--- Step 1: Therapist Login ---");
  const loginTherapistRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "testtherapist@fluentvoice.io",
      password: "TestPass123"
    })
  });
  
  if (!loginTherapistRes.ok) {
    const errorText = await loginTherapistRes.text();
    throw new Error(`Therapist login failed: ${errorText}`);
  }
  
  const therapistData = await loginTherapistRes.json();
  const therapistToken = getCookie(loginTherapistRes.headers);
  const therapistId = therapistData.user.id;
  console.log(`Logged in as therapist: ${therapistData.user.name} (ID: ${therapistId})`);

  // 2. Register a new patient assigned to this therapist
  console.log("\n--- Step 2: Patient Registration ---");
  const uniqueEmail = `patient_${Date.now()}@test.com`;
  const registerPatientRes = await fetch(`${BASE_URL}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Auto Integration Patient",
      email: uniqueEmail,
      password: "PatientPassword123",
      role: "patient",
      therapistId: therapistId
    })
  });

  if (!registerPatientRes.ok) {
    const errorText = await registerPatientRes.text();
    throw new Error(`Patient registration failed: ${errorText}`);
  }

  const patientData = await registerPatientRes.json();
  const patientToken = getCookie(registerPatientRes.headers);
  const patientId = patientData.user.id;
  console.log(`Registered new patient: ${patientData.user.name} (ID: ${patientId}, Email: ${uniqueEmail})`);

  // 3. Retrieve patients list as therapist to verify assignment and stats
  console.log("\n--- Step 3: Therapist Dashboard Patient Fetch ---");
  const getPatientsRes = await fetch(`${BASE_URL}/api/therapist/patients`, {
    headers: { "Cookie": `fv_token=${therapistToken}` }
  });
  if (!getPatientsRes.ok) {
    throw new Error("Therapist could not fetch patients list");
  }
  const patientsList = await getPatientsRes.json();
  const foundPatient = patientsList.patients.find(p => p.id === patientId);
  if (!foundPatient) {
    throw new Error("Patient not found in therapist's patient list!");
  }
  console.log(`Found Patient: ${foundPatient.name}`);
  console.log(`Email: ${foundPatient.email}`);
  console.log(`Joined: ${foundPatient.joinedDate}`);
  console.log(`Assessment Status: ${foundPatient.assessmentStatus}`);
  console.log(`Treatment Plan Status: ${foundPatient.treatmentPlanStatus}`);
  console.log(`Latest Session Date: ${foundPatient.lastSessionDate}`);

  if (foundPatient.assessmentStatus !== "pending") {
    throw new Error("Expected assessmentStatus to be 'pending'");
  }
  if (foundPatient.treatmentPlanStatus !== "pending") {
    throw new Error("Expected treatmentPlanStatus to be 'pending'");
  }

  // 4. Book appointment as patient
  console.log("\n--- Step 4: Patient Books Appointment ---");
  const bookApptRes = await fetch(`${BASE_URL}/api/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `fv_token=${patientToken}`
    },
    body: JSON.stringify({
      date: "2026-07-15",
      time: "11:00 AM",
      type: "telehealth",
      notes: "Testing auto synchronization"
    })
  });

  if (!bookApptRes.ok) {
    const errorText = await bookApptRes.text();
    throw new Error(`Appointment booking failed: ${errorText}`);
  }
  const apptResult = await bookApptRes.json();
  const apptId = apptResult.id;
  console.log(`Successfully booked appointment (ID: ${apptId}) in pending status.`);

  // 5. Therapist retrieves appointments and confirms (accepts) it
  console.log("\n--- Step 5: Therapist Accepts Appointment ---");
  const therapistApptsRes = await fetch(`${BASE_URL}/api/appointments`, {
    headers: { "Cookie": `fv_token=${therapistToken}` }
  });
  const therapistAppts = await therapistApptsRes.json();
  const foundAppt = therapistAppts.appointments.find(a => a.id === apptId);
  if (!foundAppt) {
    throw new Error("Appointment not found in therapist appointments list!");
  }
  console.log(`Found pending appointment in therapist view. Status: ${foundAppt.status}`);

  const confirmApptRes = await fetch(`${BASE_URL}/api/appointments/${apptId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `fv_token=${therapistToken}`
    },
    body: JSON.stringify({ status: "accepted" })
  });
  if (!confirmApptRes.ok) {
    throw new Error("Therapist failed to accept appointment");
  }
  console.log("Appointment status updated to 'accepted' by therapist.");

  // 6. Patient retrieves appointments to verify status synchronization
  console.log("\n--- Step 6: Patient Verifies Appointment Status ---");
  const patientApptsRes = await fetch(`${BASE_URL}/api/appointments`, {
    headers: { "Cookie": `fv_token=${patientToken}` }
  });
  const patientAppts = await patientApptsRes.json();
  const verifiedAppt = patientAppts.appointments.find(a => a.id === apptId);
  if (!verifiedAppt || verifiedAppt.status !== "accepted") {
    throw new Error(`Synchronization verification failed. Expected status 'accepted', got: ${verifiedAppt?.status}`);
  }
  console.log(`OK: Patient dashboard synchronized. Appointment status is indeed '${verifiedAppt.status}'.`);

  // 7. Therapist updates treatment plan (Version 1)
  console.log("\n--- Step 7: Therapist Saves Treatment Plan Version 1 ---");
  const updatePlanRes = await fetch(`${BASE_URL}/api/treatment`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `fv_token=${therapistToken}`
    },
    body: JSON.stringify({
      patientId: patientId,
      goals: ["Perform integration tests"],
      exercises: ["Daily system checks"],
      remarks: "Version 1 remarks"
    })
  });
  if (!updatePlanRes.ok) {
    throw new Error("Failed to save treatment plan V1");
  }

  // 8. Therapist updates treatment plan again (Version 2)
  console.log("\n--- Step 8: Therapist Saves Treatment Plan Version 2 ---");
  const updatePlanRes2 = await fetch(`${BASE_URL}/api/treatment`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Cookie": `fv_token=${therapistToken}`
    },
    body: JSON.stringify({
      patientId: patientId,
      goals: ["Perform integration tests", "Validate database synchronization"],
      exercises: ["Daily system checks", "Run scripts"],
      remarks: "Version 2 remarks"
    })
  });
  if (!updatePlanRes2.ok) {
    throw new Error("Failed to save treatment plan V2");
  }

  // 9. Therapist fetches patient details to verify history list
  console.log("\n--- Step 9: Therapist Fetches Patient Profile and History ---");
  const patientDetailsRes = await fetch(`${BASE_URL}/api/therapist/patients/${patientId}`, {
    headers: { "Cookie": `fv_token=${therapistToken}` }
  });
  if (!patientDetailsRes.ok) {
    throw new Error("Therapist could not fetch patient details");
  }
  const details = await patientDetailsRes.json();
  console.log(`Fetched details for ${details.patient.name}.`);
  console.log(`Appointments History Count: ${details.appointments.length}`);
  console.log(`Treatment Plan Versions Count: ${details.treatmentPlanHistory.length}`);

  if (details.appointments.length !== 1 || details.appointments[0].status !== "accepted") {
    throw new Error("Invalid appointments history record");
  }
  if (details.treatmentPlanHistory.length < 2) {
    throw new Error("Expected at least 2 versions in treatment plan history");
  }
  console.log("OK: Past appointments and treatment plan version histories successfully loaded.");

  console.log("\n=== ALL INTEGRATION TESTS PASSED SUCCESSFULLY ===");
}

runTests().catch(err => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
