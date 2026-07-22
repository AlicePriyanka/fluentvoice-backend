import { Router, Request, Response } from "express";
import multer from "multer";

const router = Router();
const upload = multer();

const HF_API = "https://ramlakshman-fluentvoice-api.hf.space/analyze";

// POST /api/analyze
router.post("/", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const audio = req.file;

    if (!audio) {
      return res.status(400).json({ error: "No audio file provided" });
    }

    // Forward to HuggingFace with required extra fields
    const hfForm = new FormData();
    const blob = new Blob([audio.buffer], { type: audio.mimetype });
    hfForm.append("audio", blob, audio.originalname || "recording.wav");
    hfForm.append("condition_on_previous_text", "false");
    hfForm.append("no_speech_threshold", "0.6");

    const resp = await fetch(HF_API, {
      method: "POST",
      body: hfForm,
      // HuggingFace Spaces can take a while on cold start
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("HF API error:", resp.status, text);
      return res.status(resp.status).json({
        error: `Analysis API returned ${resp.status}: ${text.slice(0, 200)}`
      });
    }

    const raw = await resp.json() as any;

    // Normalize disfluency events — the HF API uses either "event"/"type" and
    // "time"/"start"/"timestamp" depending on the model version.
    const normalizeDisfluencies = (arr: any[]) =>
      arr.map((ev) => ({
        event: ev.event ?? ev.type ?? "unknown",
        word:  ev.word  ?? ev.token ?? undefined,
        time:  ev.time  ?? ev.start ?? ev.timestamp ?? "0:00",
        duration: ev.duration ?? undefined,
      }));

    const score = raw.fluency_score ?? raw.score ?? 0;

    // Re-derive severity from score
    function scoreSeverity(s: number): "mild" | "moderate" | "severe" {
      if (s >= 70) return "mild";
      if (s >= 40) return "moderate";
      return "severe";
    }

    const normalized = {
      ...raw,
      fluency_score: score,
      severity:      scoreSeverity(score),
      speech_rate:   raw.speech_rate ?? raw.wpm ?? 0,
      transcript:    raw.transcript ?? raw.text ?? "",
      disfluencies:  normalizeDisfluencies(raw.disfluencies ?? raw.events ?? []),
      pauses:        raw.pauses ?? 0,
      timeline:      raw.timeline ?? [],
    };

    return res.json(normalized);
  } catch (err) {
    console.error("Analyze route error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

export default router;
