const PRINT_CSS = `
  @media print {
    @page { margin: 18mm 16mm; }
    body { background: #fff !important; }
    aside, .no-print { display: none !important; }
    .app-main { margin-left: 0 !important; }
    .print-header { position: static !important; box-shadow: none !important; border-bottom: 1px solid #e2e8f0 !important; }
    a { color: inherit !important; text-decoration: none !important; }
  }
`;

export default function AboutPage({ S }) {
  const Section = ({ title, sub, children }) => (
    <div style={{ marginBottom: 48 }}>
      <div style={S.sectionTitle}>{title}</div>
      {sub && <div style={S.sectionSub}>{sub}</div>}
      {children}
    </div>
  );

  const Card = ({ children, style }) => (
    <div style={{ ...S.card, ...style }}>{children}</div>
  );

  const H3 = ({ children }) => (
    <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 15, color: "#0f172a", marginBottom: 10 }}>
      {children}
    </div>
  );

  const P = ({ children, style }) => (
    <p style={{ fontSize: 13, color: "#475569", lineHeight: 1.8, marginBottom: 10, ...style }}>{children}</p>
  );

  const Tag = ({ children, color = "#3b82f6" }) => (
    <span style={{ display: "inline-block", background: color + "18", color, borderRadius: 4, padding: "2px 10px", fontSize: 11, fontFamily: "'Inter', sans-serif", fontWeight: 700, letterSpacing: "0.06em", marginRight: 6, marginBottom: 4 }}>
      {children}
    </span>
  );

  const Code = ({ children }) => (
    <code style={{ background: "#1e293b", color: "#e2e8f0", padding: "2px 7px", borderRadius: 4, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>
      {children}
    </code>
  );

  const Divider = () => (
    <div style={{ height: 1, background: "#e2e8f0", margin: "20px 0" }} />
  );

  const steps = [
    { n: "1", label: "Configure Assessments", color: "#3b82f6", desc: "Set the Topin config URL and duration for each Skill + Level combination. This is the master reference all other pages use." },
    { n: "2", label: "Upload Student Bookings", color: "#7c3aed", desc: "Upload a CSV (or fetch directly from the Replit/Neon DB) for a contest date. The system auto-creates unique Exam Sessions from the bookings." },
    { n: "3", label: "Publish Sessions on Topin", color: "#f5a623", desc: "A local Playwright server logs into Topin, clones the base template per session, applies the config, and marks each session as Published." },
    { n: "4", label: "Invite Students", color: "#00c896", desc: "An API call is made for each pending student linking them to their Unique Exam ID on Topin." },
    { n: "5", label: "Track & Export", color: "#059669", desc: "The Invited Students page shows every student's personalised assessment link, TinyURL, invite status, and lets you download a CSV." },
  ];

  return (
    <div style={{ animation: "fadeIn 0.2s ease" }} className="print-root">
      <style>{PRINT_CSS}</style>
      <div style={S.header} className="print-header">
        <span style={S.headerTitle}>About</span>
        <div style={{ marginLeft: "auto", paddingBottom: 18, paddingTop: 18 }} className="no-print">
          <button
            onClick={() => window.print()}
            style={{ ...S.btn("secondary"), padding: "7px 18px", fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            ↓ Download PDF
          </button>
        </div>
      </div>

      <div style={{ ...S.body, maxWidth: 900 }}>

        {/* ── Overview ── */}
        <Section title="What is this app?" sub="NxtWave Admin — Assessment Config Manager">
          <Card>
            <P>
              This is an internal operations tool for managing the full lifecycle of <strong>NIAT / GRIT assessment contests</strong>.
              It covers everything from setting up assessment configurations and uploading student bookings,
              to publishing exam sessions on the Topin platform, sending personalised invites to students, and tracking results.
            </P>
            <P style={{ marginBottom: 0 }}>
              Access is role-gated — an admin must approve each new user and assign them a role that controls which pages they can see.
              The app is deployed on <strong>GitHub Pages</strong> (frontend) and uses <strong>Firebase Firestore</strong> as its database.
              Publishing and inviting requires a <strong>local server</strong> to be running on the operator's machine.
            </P>
          </Card>
        </Section>

        {/* ── Flow ── */}
        <Section title="How it works" sub="The end-to-end journey from config to invite.">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {steps.map((step, i) => (
              <div key={step.n} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: "50%", background: step.color + "18", border: `2px solid ${step.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', sans-serif", fontWeight: 800, fontSize: 14, color: step.color }}>
                  {step.n}
                </div>
                {i < steps.length - 1 && (
                  <div style={{ position: "absolute", marginLeft: 17, marginTop: 36, width: 2, height: 12, background: "#e2e8f0" }} />
                )}
                <div style={{ ...S.card, flex: 1, margin: 0, padding: "16px 20px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 13, color: step.color, marginBottom: 4 }}>
                    {step.label}
                  </div>
                  <P style={{ marginBottom: 0 }}>{step.desc}</P>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Page Reference ── */}
        <Section title="Page-by-page guide" sub="What each page does and how to use it.">

          {/* Assessment Configurations */}
          <Card>
            <H3>Assessment Configurations <Tag color="#3b82f6">assessments</Tag></H3>
            <P>
              The master config store. Every assessment on Topin is identified by a <strong>Skill + Level</strong> combination (e.g., <em>SQL - L2</em>).
              Here you link that combination to its Topin <strong>config URL</strong> and set the <strong>duration in minutes</strong>.
              The duration is used to auto-compute the End Time when a booking session is created.
            </P>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                ["Add / Edit", "Form to create a new Skill+Level entry or edit an existing one. Prevents duplicate combinations. Shows the last 5 entries for quick reference."],
                ["All Assessments", "Full table of every saved config, filterable by Skill and Level. Use Edit to update a URL or duration; Del to remove."],
                ["Skills & Levels", "Manage the dropdown values used across the app. Adding/removing here updates all pickers globally. Removing a skill does not delete assessments already stored under it."],
              ].map(([tab, desc]) => (
                <div key={tab} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 6 }}>{tab}</div>
                  <P style={{ marginBottom: 0, fontSize: 12 }}>{desc}</P>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12, color: "#2563eb", lineHeight: 1.7 }}>
              <strong>Important:</strong> If an assessment config is missing for a booking's Skill+Level, the session will show a ⚠ warning and its End Time will be 0 minutes from Start. Always configure assessments before uploading bookings.
            </div>
          </Card>

          {/* Student Bookings */}
          <Card>
            <H3>Student Bookings <Tag color="#7c3aed">bookings</Tag></H3>
            <P>
              The data pipeline. Bookings come in either via <strong>CSV upload</strong> or pulled directly from the <strong>Replit/Neon Postgres database</strong>.
              On import the system automatically generates <strong>Unique Exam Sessions</strong> — one per distinct Skill + Level + Date + Time Slot combination.
            </P>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                ["Upload CSV", <>Required columns: <Code>Booking ID</Code>, <Code>Skill</Code>, <Code>Skill Level</Code>, <Code>Contest Date</Code>, <Code>Time Slot</Code>. If duplicate Booking IDs are found you can choose to skip them (save only new rows) or overwrite all. A <strong>Buffer Time</strong> (minutes, default 30) is added on top of the configured duration to compute End Time.</>],
                ["Fetch from DB", <>Pick a contest date and click Fetch — the app calls the backend which queries the Postgres DB and returns all bookings for that date. You can also download the fetched data as a CSV before saving.</>],
                ["Slot Bookings", <>Raw booking rows table. Filterable by Date, Skill, Level, Time Slot, Campus, Batch, and Invite Status. Rows where invite has already been sent are protected from bulk delete.</>],
                ["Unique Assessments", <>One row per exam session. Shows Publish Status (Pending / Published / Failed), the auto-generated EXIT PIN, and Topin Assessment ID once published. You can manually mark a session as published, reset it to Pending, download as CSV, or bulk-delete unpublished sessions.</>],
                ["User Mapping", <>Each student cross-referenced to their Unique Exam ID. A ⚠ icon appears if no matching session was found (usually means the booking was uploaded before the session was created). Downloadable as CSV.</>],
              ].map(([tab, desc]) => (
                <div key={tab} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 6 }}>{tab}</div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{ padding: "12px 16px", background: "#fefce8", border: "1px solid #fef08a", borderRadius: 8, fontSize: 12, color: "#854d0e", lineHeight: 1.7 }}>
              <strong>Session Key logic:</strong> Two bookings with the same Skill, Level, Date, and Time Slot share one Exam Session. The key is <Code>skill||level||YYYY-MM-DD||HHMM</Code>. Uploading the same session twice reuses the existing session instead of creating a duplicate.
            </div>
          </Card>

          {/* Create Assessments */}
          <Card>
            <H3>Create Assessments <Tag color="#f5a623">create</Tag></H3>
            <P>
              The automation hub. This page talks to a <strong>local Node.js + Playwright server</strong> running on your machine at <Code>http://localhost:3001</Code>.
              The server is what actually logs into Topin and drives the browser — it cannot run from the cloud because Topin's login flow requires a browser session.
            </P>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#00c896", display: "inline-block" }} />
              <span style={{ fontSize: 12, color: "#64748b" }}>Green dot = server reachable. Red dot = server offline. Run <Code>node src/index.js</Code> in the server folder.</span>
            </div>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              {[
                ["Select & Run", <>Pick an assessment date (or leave blank for all dates). Four counters show: <strong>To Publish</strong>, <strong>Published</strong>, <strong>Invites Pending</strong>, <strong>Invites Sent</strong>. Two action buttons: <strong>Publish Sessions</strong> and <strong>Invite Students</strong>. A real-time progress log streams from the server via SSE (Server-Sent Events).</>],
                ["Credentials", <>Stored in Firestore and auto-loaded on every device. Contains: Local Server URL (browser-only, not Firestore), Topin Login URL, Mobile + Fixed OTP for Topin auth, Invite API Endpoint + Key, and TinyURL token. Only users with the "Credentials" permission can see this tab.</>],
              ].map(([tab, desc]) => (
                <div key={tab} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 6 }}>{tab}</div>
                  <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.7 }}>{desc}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ padding: "12px 16px", background: "#f0fdf9", border: "1px solid #6ee7b7", borderRadius: 8, fontSize: 12, color: "#065f46", lineHeight: 1.7 }}>
                <strong>Publish Sessions:</strong> For each unpublished Exam Session on the selected date, the server logs into Topin with the OTP, clones the base template, applies the config URL from Assessments, sets start/end times and the EXIT PIN, then publishes. The Topin Assessment ID and config/details links are saved back to Firestore.
              </div>
              <div style={{ padding: "12px 16px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, fontSize: 12, color: "#1e40af", lineHeight: 1.7 }}>
                <strong>Invite Students:</strong> For each student on the selected date whose invite hasn't been sent yet, a POST is made to the Invite API with the student's UID and Unique Exam ID. Status is saved back to the booking record in Firestore.
              </div>
            </div>
          </Card>

          {/* Invited Students */}
          <Card>
            <H3>Invited Students <Tag color="#00c896">invited</Tag></H3>
            <P>
              Read-only tracker for all students across all dates. Every booking row is joined with its session to show the full picture:
              personalised assessment link, TinyURL, invite status, config link, and details link.
              Supports text search (name, NIAT ID, UID, Exam ID) and dropdown filters. Downloadable as CSV.
            </P>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                ["User Assessment Link", "The student-facing link derived from the session's assessment link — the admin token parameter (?a_t=CLIENT) is stripped so the student sees a clean URL."],
                ["TinyURL", "A shortened version of the User Assessment Link. Generated on demand via the TinyURL API. Click 'Generate TinyURLs' in the header to batch-generate for all sessions that don't have one yet."],
                ["Config / Details Links", "Admin-only links back into the Topin platform — Config Link opens the assessment configuration page, Details Link opens the session analytics/details page."],
              ].map(([col, desc]) => (
                <div key={col} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 6 }}>{col}</div>
                  <P style={{ marginBottom: 0, fontSize: 12 }}>{desc}</P>
                </div>
              ))}
            </div>
          </Card>

          {/* Interview Schedule */}
          <Card>
            <H3>Interview Schedule <Tag color="#64748b">interviews</Tag></H3>
            <P>
              Manage and view interview slots. An admin uploads a CSV with all interviews; each panelist then sees <strong>only their own rows</strong> — the table is automatically filtered by the logged-in user's email against the <Code>Panelist Email</Code> column.
            </P>
            <div style={{ padding: "12px 16px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, color: "#475569", lineHeight: 1.7 }}>
              <strong>Required CSV columns:</strong> <Code>Candidate Name</Code>, <Code>Panelist Email</Code>. Optional: <Code>Candidate UID</Code>, <Code>Candidate Resume</Code>, <Code>Interview Date</Code>, <Code>Interview Time</Code>, <Code>Panelist Name</Code>, <Code>BOA</Code>, <Code>Meet Link</Code>, <Code>Recording Link</Code>, <Code>Interview Status</Code>, <Code>Role</Code>, <Code>Round</Code>.
            </div>
          </Card>

          {/* Admin Panel */}
          <Card>
            <H3>Admin Panel <Tag color="#ef4444">admin</Tag> <Tag color="#94a3b8">admins only</Tag></H3>
            <P>
              User lifecycle management. Only users with role <Code>admin</Code> or <Code>super-admin</Code> can access this page.
            </P>
            <Divider />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {[
                ["Pending", "New signups land here. An admin selects a role from the dropdown and clicks Approve to activate the account. Clicking Reject permanently deletes the user record."],
                ["All Users", "All active accounts. You can change a user's role (takes effect immediately — they are notified in-app) or Revoke access (returns them to Pending). You cannot change your own role. You cannot demote the last remaining admin."],
                ["Roles & Access", "Create custom roles and toggle which pages each role can access. Changes are instant — all users on that role see the effect without re-logging in. System roles (admin, super-admin) cannot be deleted. A role cannot be deleted while users are assigned to it."],
              ].map(([tab, desc]) => (
                <div key={tab} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 12, color: "#0f172a", marginBottom: 6 }}>{tab}</div>
                  <P style={{ marginBottom: 0, fontSize: 12 }}>{desc}</P>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        {/* ── Key Concepts ── */}
        <Section title="Key concepts" sub="Terms and logic you'll encounter throughout the app.">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {[
              ["Session Key", "A composite string that uniquely identifies one exam slot: skill||level||YYYY-MM-DD||HHMM. Two bookings with the same four values share one session — uploading the same data twice will reuse the existing session rather than creating a duplicate."],
              ["Unique Exam ID", <>Auto-generated identifier in the format <Code>NG26_NIAT_GRIT_SKILL_LN_YYYY-MM-DD_HHMM</Code>. This is what the invite API uses to link a student to their specific exam on Topin.</>],
              ["Buffer Time", "Extra minutes added on top of the assessment duration to compute End Time. Default is 30 minutes. Useful for giving students time to read instructions, take breaks, etc. Applied at upload time — changing it later requires re-uploading."],
              ["EXIT PIN", "A 6-character alphanumeric PIN auto-generated per session. Used as the exam exit code on Topin. Shown in the Unique Assessments table with an orange badge."],
              ["Local Server", <>The local Node.js + Playwright server (<Code>server/src/index.js</Code>) must be running on your machine to use Publish Sessions or Invite Students. It handles browser automation and API calls that can't be done securely from the browser. The green/red dot in the Create Assessments header shows its status.</>],
              ["Role-based access", "Every user has a role (e.g., 'Operator', 'Panelist'). Roles define which pages are accessible — locked pages show a 🔒 icon in the sidebar. The Credentials tab within Create Assessments is an additional permission on top of page access."],
            ].map(([title, desc]) => (
              <div key={title} style={{ ...S.card, marginBottom: 0, padding: "20px 24px" }}>
                <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 8 }}>{title}</div>
                <div style={{ fontSize: 12.5, color: "#475569", lineHeight: 1.8 }}>{desc}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Architecture ── */}
        <Section title="Architecture & tech stack" sub="What the app is built on.">
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              {[
                ["Frontend", "React + Vite, deployed as a static site on GitHub Pages. All styles are inline (no CSS framework). Routing via React Router."],
                ["Auth & Database", "Firebase Authentication (Google sign-in) + Firestore for all app data: bookings, sessions, assessments, users, roles, settings, and logs."],
                ["Local Server", "Node.js + Express + Playwright. Runs on the operator's machine. Handles Topin browser automation and the student invite API calls. Streams progress back to the browser via SSE."],
                ["Topin", "The external assessment platform. Sessions are created/published here via the config URL stored in Assessment Configurations. The local server drives Topin's web UI using Playwright."],
                ["Replit / Neon DB", "A Postgres database that holds the raw booking data. The 'Fetch from DB' feature in Student Bookings queries this via the backend API."],
                ["TinyURL", "Third-party URL shortener API used to generate short links for student assessment URLs. Token is stored in Credentials and called from the local server."],
              ].map(([name, desc]) => (
                <div key={name}>
                  <div style={{ fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: 13, color: "#0f172a", marginBottom: 6 }}>{name}</div>
                  <P style={{ marginBottom: 0, fontSize: 12.5 }}>{desc}</P>
                </div>
              ))}
            </div>
          </Card>
        </Section>

      </div>
    </div>
  );
}
