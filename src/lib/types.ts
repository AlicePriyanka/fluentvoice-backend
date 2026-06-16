export interface DbUser {
  _id?: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "patient" | "therapist";
  therapistId?: string;
  joinedDate: string;
  createdAt: string | Date;
}

export interface DbSession {
  _id?: string;
  userId: string;
  fluency_score: number;
  severity: "mild" | "moderate" | "severe";
  speech_rate: number;
  transcript: string;
  disfluencies: Array<{
    event: string;
    word?: string;
    time: string;
    duration?: number;
  }>;
  pauses: number;
  timeline: unknown[];
  audioUrl?: string;
  createdAt: string | Date;
}

export interface DbAppointment {
  _id?: string;
  patientId: string;
  therapistId: string;
  patientName: string;
  date: string;
  time: string;
  durationMinutes: number;
  type: "in-clinic" | "telehealth";
  status: "pending" | "confirmed" | "cancelled";
  notes: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface DbProfile {
  _id?: string;
  userId: string;
  role: "patient" | "therapist";
  phone?: string;
  age?: number;
  condition?: string;
  bio?: string;
  specialty?: string;
  licenseNumber?: string;
  clinicName?: string;
  updatedAt: string | Date;
}

export interface DbTreatmentPlan {
  _id?: string;
  patientId: string;
  therapistId?: string;
  goals: string[];
  exercises: string[];
  remarks: string;
  updatedAt: string | Date;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: "patient" | "therapist";
  therapistId?: string;
  joinedDate: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: "patient" | "therapist";
  iat?: number;
  exp?: number;
}
