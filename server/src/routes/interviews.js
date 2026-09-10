import { Router } from "express";
import { db } from "../firebase.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { fetchCompletedInterviews } from "../lib/interviewCoordinatorClient.js";
import { isNiatInterview, categorizeMastery } from "../lib/niatCategorize.js";

const router = Router();
router.use(requireAuth);

const COLLECTION = "completedNiatInterviews";
const SYNC_META_REF = () => db.collection("syncMeta").doc("completedNiatInterviewsSync");

function toFirestoreDoc(r, syncedAt) {
  return {
    interviewId: r.interviewId,
    status: r.status || "completed",
    round: r.round || "",

    candidateId: r.candidate?.id || "",
    candidateName: r.candidate?.name || "",
    candidateEmail: (r.candidate?.email || "").toLowerCase(),
    interviewerId: r.interviewer?.id || "",
    interviewerName: r.interviewer?.name || "",
    interviewerEmail: (r.interviewer?.email || "").toLowerCase(),

    templateId: r.template?.id || "",
    templateName: r.template?.name || "",
    masteryType: categorizeMastery(r.template?.name || ""),

    interviewDate: r.schedule?.date || "",
    interviewTime: r.schedule?.time || "",
    completedAt: r.completedAt || "",

    meetLink: r.links?.meetLink || "",
    recordingUrl: r.links?.recordingUrl || "",
    transcriptUrl: r.links?.transcriptUrl || "",

    feedback: r.feedback || null,
    aiReport: r.aiReport || null,

    icCreatedAt: r.createdAt || "",
    icUpdatedAt: r.updatedAt || "",
    syncedAt,
  };
}

// Pull completed NIAT interviews from Interview Coordinator and upsert them.
// Idempotent: doc ID = IC's own interviewId, always merge:true — re-running
// never creates duplicates. Writes nothing on failure, so a down/erroring IC
// never touches previously-synced data.
router.post("/sync-completed", requireAdmin, async (req, res) => {
  try {
    const metaSnap = await SYNC_META_REF().get();
    const lastSyncTime = metaSnap.exists ? metaSnap.data().lastSyncTime : undefined;
    const fromDate = metaSnap.exists ? undefined : process.env.INTERVIEW_COORDINATOR_INITIAL_SYNC_FROM_DATE;

    const records = await fetchCompletedInterviews({ lastSyncTime, fromDate });
    const niatRecords = records.filter(r => isNiatInterview(r.template?.name || ""));

    const syncedAt = new Date().toISOString();
    let written = 0;
    for (let i = 0; i < niatRecords.length; i += 499) {
      const batch = db.batch();
      for (const r of niatRecords.slice(i, i + 499)) {
        if (!r.interviewId) continue; // no stable key — skip rather than risk a bad doc ID
        batch.set(db.collection(COLLECTION).doc(r.interviewId), toFirestoreDoc(r, syncedAt), { merge: true });
        written++;
      }
      await batch.commit();
    }

    await SYNC_META_REF().set({ lastSyncTime: syncedAt, lastSyncCount: written }, { merge: true });

    res.json({ success: true, fetched: records.length, matched: niatRecords.length, written, syncedAt });
  } catch (err) {
    console.error("[interviews/sync-completed] failed:", err.message);
    res.status(502).json({ error: `Could not reach Interview Coordinator: ${err.message}` });
  }
});

export default router;
