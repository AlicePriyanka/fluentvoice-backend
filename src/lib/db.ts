import Database from "better-sqlite3";
import path from "path";

// Use DATABASE_PATH env var if set (e.g. pointing to a Render Persistent Disk at /data/fluentvoice.db)
// otherwise fall back to the local project directory
const dbPath = process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "fluentvoice.db");
const db = new Database(dbPath);

// Enable foreign key support
db.pragma("foreign_keys = ON");

export default db;
