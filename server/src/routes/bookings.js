import { Router } from "express";
import pg from "pg";
import { db } from "../firebase.js";
import { requireAuth } from "../middleware/auth.js";

const { Client } = pg;
const router = Router();
router.use(requireAuth);

const CUTOFF_DAYS = 90;
function cutoffDate() {
  return new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

router.get("/", async (req, res) => {
  try {
    const snap = await db.collection("bookingRows")
      .where("contestDate", ">=", cutoffDate())
      .orderBy("contestDate", "asc")
      .get();
    res.json({ rows: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk save bookings + new sessions in one request (keeps them atomic-ish)
router.post("/bulk-save", async (req, res) => {
  try {
    const { bookingOps, newSessions, batchId } = req.body;
    const now = new Date().toISOString();
    const CHUNK = 499;

    // Write bookings
    for (let i = 0; i < bookingOps.length; i += CHUNK) {
      const batch = db.batch();
      for (const op of bookingOps.slice(i, i + CHUNK)) {
        const ref = op.id
          ? db.collection("bookingRows").doc(op.id)
          : db.collection("bookingRows").doc();
        const data = { ...op.data, uploadBatchId: batchId, uploadedAt: now };
        op.type === "update" ? batch.update(ref, data) : batch.set(ref, data);
      }
      await batch.commit();
    }

    // Write new sessions
    for (let i = 0; i < newSessions.length; i += CHUNK) {
      const batch = db.batch();
      for (const s of newSessions.slice(i, i + CHUNK)) {
        batch.set(db.collection("examSessions").doc(), {
          ...s, publishStatus: "pending", uploadBatchId: batchId, uploadedAt: now,
        });
      }
      await batch.commit();
    }

    res.json({ ok: true, bookings: bookingOps.length, sessions: newSessions.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await db.collection("bookingRows").doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk delete filtered bookings
router.post("/bulk-delete", async (req, res) => {
  try {
    const { ids } = req.body;
    for (let i = 0; i < ids.length; i += 499) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + 499)) {
        batch.delete(db.collection("bookingRows").doc(id));
      }
      await batch.commit();
    }
    res.json({ ok: true, count: ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch contest bookings from Replit/Neon Postgres
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
