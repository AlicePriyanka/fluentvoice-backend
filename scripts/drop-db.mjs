import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function drop() {
  const client = await db.connect();
  try {
    await client.query("DROP TABLE IF EXISTS treatment_plan_versions CASCADE;");
    await client.query("DROP TABLE IF EXISTS treatment_plans CASCADE;");
    await client.query("DROP TABLE IF EXISTS appointments CASCADE;");
    await client.query("DROP TABLE IF EXISTS sessions CASCADE;");
    await client.query("DROP TABLE IF EXISTS profiles CASCADE;");
    await client.query("DROP TABLE IF EXISTS users CASCADE;");
    console.log("Dropped all tables successfully.");
  } catch (err) {
    console.error("Error dropping tables:", err);
  } finally {
    client.release();
    db.end();
  }
}

drop();
