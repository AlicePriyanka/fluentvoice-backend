import pg from "pg";
const { Pool } = pg;

async function testConnection(url) {
  console.log(`Testing: ${url}`);
  const pool = new Pool({ connectionString: url });
  try {
    const res = await pool.query("SELECT NOW()");
    console.log("Success:", res.rows[0]);
    return true;
  } catch (err) {
    console.log("Error:", err.message);
    return false;
  } finally {
    await pool.end();
  }
}

async function run() {
  const urls = [
    "postgres://postgres:123user@localhost:5432/fluentvoice_db",
    "postgres://nithishkumar:123user@localhost:5432/fluentvoice_db",
  ];

  for (const url of urls) {
    const success = await testConnection(url);
    if (success) {
      console.log(`\nWORKS: ${url}`);
      break;
    }
  }
}

run();
