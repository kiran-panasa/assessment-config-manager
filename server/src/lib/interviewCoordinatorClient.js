// Client for Interview Coordinator's (IC) documented external-consumer endpoint:
//   GET /api/sync/completed-interviews — bearer-token auth, server-side
//   status=="completed" filter, cursor pagination.
// Not passing programId: IC's response only ever includes program.id, never a
// name, so it can't be used to identify "NIAT" — that's done downstream by
// matching template.name instead (see niatCategorize.js).

const MAX_PAGES = 100; // safety cap — 100 pages * 200/page = 20,000 records per sync

export async function fetchCompletedInterviews({ lastSyncTime, fromDate, pageSize = 50 } = {}) {
  const baseUrl = process.env.INTERVIEW_COORDINATOR_API_URL;
  const token = process.env.INTERVIEW_COORDINATOR_API_TOKEN;
  if (!baseUrl) throw new Error("INTERVIEW_COORDINATOR_API_URL not configured on server");
  if (!token) throw new Error("INTERVIEW_COORDINATOR_API_TOKEN not configured on server");

  const all = [];
  let cursor;
  let page = 0;

  while (true) {
    const url = new URL("/api/sync/completed-interviews", baseUrl);
    if (lastSyncTime) url.searchParams.set("lastSyncTime", lastSyncTime);
    else if (fromDate) url.searchParams.set("fromDate", fromDate);
    url.searchParams.set("pageSize", String(pageSize));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Interview Coordinator returned ${res.status}`);

    const body = await res.json();
    if (!body.success) throw new Error(body.error || "Interview Coordinator sync failed");

    all.push(...(body.data || []));
    page++;

    if (!body.pagination?.hasMore || !body.pagination?.nextCursor) break;
    if (page >= MAX_PAGES) throw new Error(`Interview Coordinator sync exceeded ${MAX_PAGES} pages — aborting`);
    cursor = body.pagination.nextCursor;
  }

  return all;
}
