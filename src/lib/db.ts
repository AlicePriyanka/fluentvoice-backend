import Database from "better-sqlite3";
import path from "path";

const dbPath = path.resolve(process.cwd(), "fluentvoice.db");
const db = new Database(dbPath);

// Enable foreign key support
db.pragma("foreign_keys = ON");

export default db;
