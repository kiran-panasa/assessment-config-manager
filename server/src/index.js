import "dotenv/config";
import express from "express";
import cors from "cors";

import assessmentsRouter from "./routes/assessments.js";
import configRouter      from "./routes/config.js";
import bookingsRouter    from "./routes/bookings.js";
import sessionsRouter    from "./routes/sessions.js";
import usersRouter       from "./routes/users.js";
import rolesRouter       from "./routes/roles.js";
import settingsRouter    from "./routes/settings.js";
import interviewsRouter  from "./routes/interviews.js";
import logsRouter        from "./routes/logs.js";
import publishRouter     from "./routes/publish.js";

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

app.use("/api/assessments", assessmentsRouter);
app.use("/api/config",      configRouter);
app.use("/api/bookings",    bookingsRouter);
app.use("/api/sessions",    sessionsRouter);
app.use("/api/users",       usersRouter);
app.use("/api/roles",       rolesRouter);
app.use("/api/settings",    settingsRouter);
app.use("/api/interviews",  interviewsRouter);
app.use("/api/logs",        logsRouter);
app.use("/api/publish",     publishRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\nAssessment Config Manager API — port ${PORT}`);
  console.log(`  GET  /api/health`);
  console.log(`  All data routes under /api/\n`);
});
