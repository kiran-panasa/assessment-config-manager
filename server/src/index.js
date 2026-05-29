import "dotenv/config";
import express from "express";
import cors from "cors";

import bookingsRouter from "./routes/bookings.js";
import publishRouter  from "./routes/publish.js";

const app = express();

const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",").map(s => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

app.use(express.json({ limit: "10mb" }));

app.get("/api/health", (_req, res) => res.json({ status: "ok", ts: Date.now() }));

// Northflank: only fetch-db remains server-side
app.use("/api/bookings", bookingsRouter);

// Local publish server: Playwright automation + SSE progress
app.use("/api/publish",  publishRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nAssessment Config Manager API — port ${PORT}`);
  console.log(`  GET  /api/health`);
  console.log(`  GET  /api/bookings/fetch-db   (Replit DB proxy)`);
  console.log(`  POST /api/publish/run         (local Playwright runner)`);
  console.log(`  GET  /api/publish/progress    (SSE stream)\n`);
});
