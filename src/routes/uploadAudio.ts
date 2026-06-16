import { Router, Request, Response } from "express";
import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { getAuthUser } from "../lib/auth";

const router = Router();
const upload = multer();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// POST /api/upload-audio
router.post("/", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    const jwt = await getAuthUser(req);
    if (!jwt) return res.status(401).json({ error: "Unauthorized" });

    const audio = req.file;
    if (!audio) return res.status(400).json({ error: "No audio file." });

    // Upload to Cloudinary as a raw/video resource
    const result = await new Promise<{ secure_url: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: "video",  // handles audio files
          folder: `fluentvoice/${jwt.sub}`,
          public_id: `session_${Date.now()}`,
          format: "mp3",
        },
        (err, res) => {
          if (err || !res) reject(err ?? new Error("Upload failed"));
          else resolve(res as { secure_url: string });
        }
      ).end(audio.buffer);
    });

    return res.json({ url: result.secure_url });
  } catch (err) {
    console.error("Upload audio error:", err);
    return res.status(500).json({ error: "Audio upload failed." });
  }
});

export default router;
