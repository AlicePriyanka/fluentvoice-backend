import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import authRouter from "./routes/auth";
import sessionsRouter from "./routes/sessions";
import profileRouter from "./routes/profile";
import appointmentsRouter from "./routes/appointments";
import therapistRouter from "./routes/therapist";
import treatmentRouter from "./routes/treatment";
import analyzeRouter from "./routes/analyze";
import uploadAudioRouter from "./routes/uploadAudio";

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS with credentials support
app.use(cors({
  origin: (origin, callback) => {
    // Dynamically allow any origin to prevent CORS issues in deployment
    callback(null, true);
  },
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date() });
});

// Register API Routes
app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/therapist", therapistRouter);
app.use("/api/treatment", treatmentRouter);
app.use("/api/analyze", analyzeRouter);
app.use("/api/upload-audio", uploadAudioRouter);

// Global Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global server error:", err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

app.listen(port, () => {
  console.log(`[FluentVoice Backend] Server running on port ${port}`);
});
