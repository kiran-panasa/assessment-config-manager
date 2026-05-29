import { Router } from "express";
import pg from "pg";
import { requireAuth } from "../middleware/auth.js";

const { Client } = pg;
const router = Router();
router.use(requireAuth);

// Fetch contest bookings from Replit/Neon Postgres — the only endpoint kept server-side
router.get("/fetch-db", async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
  const rawConn = process.env.CONTEST_BOOKINGS_DB_URL;
  if (!rawConn) return res.status(500).json({ error: "CONTEST_BOOKINGS_DB_URL not configured on server" });

  const client = new Client({
    connectionString: rawConn.replace(/\?.*$/, ""),
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT cr.booking_id, cr.student_uid, cr.skill,
              cr.skill_level::text AS skill_level,
              cr.contest_link, cr.classroom_details, cr.registered_at,
              cs.campus, cs.contest_date, cs.time_slot
       FROM contest_registrations cr
       JOIN contest_slots cs ON cr.contest_slot_id = cs.id
       WHERE cs.contest_date = $1
         AND cr.is_cancelled = false
         AND cs.is_active    = true
         AND cs.is_deleted   = false
       ORDER BY cs.time_slot, cr.booking_id`,
      [date],
    );
    res.json({ rows: result.rows, columns: result.fields.map(f => f.name), count: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

export default router;
