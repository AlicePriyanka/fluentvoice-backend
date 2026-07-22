import pg from "pg";

import dotenv from "dotenv";
dotenv.config();

const url = process.env.DATABASE_URL;

const pool = new pg.Pool({ connectionString: url });

async function ping() {
  console.log("Pinging Render DB...");
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("Render DB is awake!", res.rows[0]);
  } catch (err) {
    console.error("Failed:", err.message);
  } finally {
    pool.end();
  }
}

ping();
