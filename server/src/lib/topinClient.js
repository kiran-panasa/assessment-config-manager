import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { db } from "../firebase.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const SEB_XML    = readFileSync(join(__dir, "seb-template.xml"), "utf-8");
const EMAIL_HTML = readFileSync(join(__dir, "invite-email-template.html"), "utf-8");

const IB_API     = "https://ib-user-accounts-backend-prod-apis.ccbp.in";
const TOPIN_API  = "https://nxtwave-assessments-backend-topin-prod-apis.ccbp.in";
const GRAPHQL    = "https://topin-config-prod-apis.ccbp.in/v1/graphql/";

// ── Request body encoding (all IB + Topin endpoints use this format) ──────────
// Body shape: { data: JSON.stringify(JSON.stringify(inner)), clientKeyDetailsId: 1 }

function enc(inner, clientKeyDetailsId = 1) {
  return JSON.stringify({ data: JSON.stringify(JSON.stringify(inner)), clientKeyDetailsId });
}

// ── Token storage ─────────────────────────────────────────────────────────────

const TOKEN_DOC = () => db.collection("settings").doc("topin_tokens");

export async function loadTokens() {
  const snap = await TOKEN_DOC().get();
  return snap.exists ? snap.data() : null;
}

export async function saveTokens(partial) {
  await TOKEN_DOC().set(partial, { merge: true });
}

// ── Capture tokens from Playwright responses ──────────────────────────────────
// Call this on the Playwright context before login to automatically save tokens.

export function setupTokenCapture(context, broadcast) {
  context.on("response", async (response) => {
    try {
      const url = response.url();

      if (url.includes("login_otp/verify/v1")) {
        const data = await response.json().catch(() => null);
        if (data?.access_token) {
          const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
          await saveTokens({
            ib_access_token:  data.access_token,
            ib_refresh_token: data.refresh_token,
            ib_expires_at:    expiresAt,
          });
          broadcast("info", "[AUTH] IB tokens captured and saved.");
        }
      }

      if (url.includes("nw_auth/login/auth_code/v2")) {
        const data = await response.json().catch(() => null);
        if (data?.access_token) {
          const expiresAt = Date.now() + parseFloat(data.expires_in || 3600) * 1000;
          await saveTokens({
            topin_access_token:  data.access_token,
            topin_refresh_token: data.refresh_token,
            topin_expires_at:    expiresAt,
          });
          broadcast("info", "[AUTH] Topin tokens captured and saved.");
        }
      }
    } catch { /* non-fatal */ }
  });
}

// ── Token refresh (no OTP needed) ─────────────────────────────────────────────

async function getTopinCodeFromIbToken(ibAccessToken) {
  const res = await fetch(`${IB_API}/api/ib_user_accounts/code/v1/`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ibAccessToken}`, "Content-Type": "application/json" },
    body: enc({ client_id: "topin" }),
  });
  if (!res.ok) throw new Error(`code/v1 failed: ${res.status}`);
  const { code } = await res.json();
  return code;
}

async function exchangeCodeForTopinTokens(code) {
  const res = await fetch(`${TOPIN_API}/api/nw_auth/login/auth_code/v2/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: enc({ code }),
  });
  if (!res.ok) throw new Error(`auth_code/v2 failed: ${res.status}`);
  return await res.json();
}

async function refreshIbAccessToken(ibRefreshToken) {
  const res = await fetch(`${IB_API}/api/ib_user_accounts/token/refresh/v1/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: enc({ refresh_token: ibRefreshToken }),
  });
  if (!res.ok) throw new Error(`IB refresh failed: ${res.status}`);
  return await res.json();
}

// Returns a valid Topin access_token or null (caller must do OTP login).
export async function getValidTopinToken(broadcast = () => {}) {
  const stored = await loadTokens();
  if (!stored) return null;

  const now = Date.now();
  const BUFFER = 5 * 60 * 1000; // 5 min safety buffer

  // 1. Topin token still valid
  if (stored.topin_access_token && stored.topin_expires_at - now > BUFFER) {
    return stored.topin_access_token;
  }

  broadcast("info", "[AUTH] Topin token expired — refreshing…");

  // 2. Try: IB access_token → new Topin code → new Topin token
  if (stored.ib_access_token && stored.ib_expires_at - now > BUFFER) {
    try {
      const code = await getTopinCodeFromIbToken(stored.ib_access_token);
      const tokens = await exchangeCodeForTopinTokens(code);
      const expiresAt = now + parseFloat(tokens.expires_in || 3600) * 1000;
      await saveTokens({ topin_access_token: tokens.access_token, topin_refresh_token: tokens.refresh_token, topin_expires_at: expiresAt });
      broadcast("info", "[AUTH] Topin token refreshed via IB token.");
      return tokens.access_token;
    } catch (err) {
      broadcast("warn", `[AUTH] IB token refresh attempt failed: ${err.message}`);
    }
  }

  // 3. Try: IB refresh_token → new IB access_token → repeat step 2
  if (stored.ib_refresh_token) {
    try {
      const ibData = await refreshIbAccessToken(stored.ib_refresh_token);
      const ibExpiresAt = now + (ibData.expires_in || 3600) * 1000;
      await saveTokens({ ib_access_token: ibData.access_token, ib_refresh_token: ibData.refresh_token || stored.ib_refresh_token, ib_expires_at: ibExpiresAt });

      const code = await getTopinCodeFromIbToken(ibData.access_token);
      const tokens = await exchangeCodeForTopinTokens(code);
      const topinExpiresAt = now + parseFloat(tokens.expires_in || 3600) * 1000;
      await saveTokens({ topin_access_token: tokens.access_token, topin_refresh_token: tokens.refresh_token, topin_expires_at: topinExpiresAt });
      broadcast("info", "[AUTH] Topin token refreshed via IB refresh token.");
      return tokens.access_token;
    } catch (err) {
      broadcast("warn", `[AUTH] Full token refresh failed: ${err.message}`);
    }
  }

  return null; // Need fresh OTP login
}

// ── User profile (org_id + user_id for GraphQL) ────────────────────────────────

export async function getTopinProfile(accessToken) {
  const stored = await loadTokens();
  if (stored?.topin_user_id && stored?.topin_org_id) {
    return { user_id: stored.topin_user_id, org_id: stored.topin_org_id };
  }
  const res = await fetch(`${TOPIN_API}/api/nw_auth/user/profile/v1/`, {
    headers: { "Authorization": `Bearer ${accessToken}` },
  });
  const data = await res.json();
  const user_id = data.user_id;
  const org_id  = data.organisation_details?.org_id;
  await saveTokens({ topin_user_id: user_id, topin_org_id: org_id });
  return { user_id, org_id };
}

// ── Static assessment config ───────────────────────────────────────────────────

const NIAT_ORG = {
  org_id:      "c6ec8dcb-d4e0-46e5-8123-f33974646b94",
  name:        "NIAT",
  logo_url:    "https://ezexam-mum.s3.ap-south-1.amazonaws.com/static_root/img/custom/niatadmissiontest-logotext-2.png",
  description: "",
};

const STATIC_TAGS = ["SHOW_SCORE_ON_LEVEL_COMPLETION", "IS_SEB_EXAM", "HIDE_WHATSAPP_ICON"];

const INSTRUCTIONS = [
  `Check the assessment time carefully. You can <b>only take the assessment at the times mentioned.</b>`,
  `Be ready with your fully charged laptop/computer 5-10 minutes before the assessment starts.`,
  `<b>You cannot take the assessment on a mobile or tablet.</b> `,
  `Before the assessment, make sure notifications on your laptop/computer are turned off, other devices are silenced, and <b>all unnecessary tabs/windows are closed</b>.`,
  `<b>Use Google Chrome for the assessment</b>. Other browsers may cause problems.`,
  `Take the assessment in a <b>well-lit area</b> for better proctoring.`,
  `During the assessment, don't cheat or use calculator, phone, or electronic devices. Also, <b>don't switch between different tabs on your computer</b> because the assessment is being monitored.`,
  `<b>If you switch tabs, your assessment will be terminated, and you won't be allowed to attempt it again.</b> `,
  `You'll find the WhatsApp icon at the bottom-right corner of the screen. Feel free to contact us if you have any technical problems.`,
].join("\n");

const EVENT_CONFIG = {
  invite_email_template: {
    subject: `Invitation to GRIT Contest | ["assessment_title"]`,
    body:    EMAIL_HTML,
  },
  remainder_email_template: null,
  send_on_complete_event:   false,
};

const INTEGRITY_CONFIG = {
  is_pin_required:               true,
  enable_face_authentication:    true,
  assess_pin_mode:               "ORGANISATION_PIN",
  enable_periodic_pin_validation: true,
};

// ── Datetime formatting ────────────────────────────────────────────────────────

function fmtDatetime(dateStr, timeStr) {
  const [year, month, day] = dateStr.split("-");
  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) throw new Error(`Invalid time "${timeStr}"`);
  let h = parseInt(m[1]);
  const p = m[3].toUpperCase();
  if (p === "PM" && h !== 12) h += 12;
  if (p === "AM" && h === 12) h = 0;
  return `${year}-${month}-${day} ${String(h).padStart(2, "0")}:${m[2]}:00`;
}

function extractConfigId(url) {
  const m = url.match(/\/(?:edit|view)-assessment\/([0-9a-f-]{36})/i);
  if (!m) throw new Error(`Cannot extract config UUID from: ${url}`);
  return m[1];
}

// ── Direct publish API ────────────────────────────────────────────────────────

export async function publishSessionDirect(accessToken, session, configUrl) {
  const configId = extractConfigId(configUrl);

  const assessData = {
    organisation_details: NIAT_ORG,
    org_assessment_details: {
      title:               session.assessmentTitle,
      description:         "",
      instructions_str:    INSTRUCTIONS,
      start_datetime:      fmtDatetime(session.dateOfAssessment, session.startTimeSlot),
      end_datetime:        fmtDatetime(session.dateOfAssessment, session.endTimeSlot),
      selection_config:    { min_score_to_qualify: null, no_of_users_to_qualify: null },
      event_config:        EVENT_CONFIG,
      content_tags:        [...STATIC_TAGS, session.uniqueExamId],
      access_config:       { is_public: false, admin_review_access_type: "PRIVATE" },
      custom_data_form_link: null,
      assessment_mode:     "SEB_BROWSER",
      user_check_in_enabled: true,
      check_in_mode:       "DURING_ASSESSMENT",
      seb_config: {
        seb_file_content_str: SEB_XML,
        custom_exit_password: session.exitPin,
      },
      integrity_config: INTEGRITY_CONFIG,
    },
  };

  const innerData = {
    user_org_assess_config_id: configId,
    assess_data: JSON.stringify(assessData),
  };

  const body = {
    data: JSON.stringify(JSON.stringify(innerData)),
    clientKeyDetailsId: 1,
  };

  const res = await fetch(`${TOPIN_API}/api/nw_assess_config/user/org_assess/publish/`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Publish API ${res.status}: ${txt.slice(0, 300)}`);
  }
  // 200 with empty body — result delivered via WebSocket to the frontend.
  // We poll GraphQL instead.
}

// ── GraphQL: find newly published assessment ───────────────────────────────────

const FIND_ASSESSMENT_QUERY = `
  query find_by_tag($user_id: uuid!, $org_id: uuid!, $tag: String!) {
    user_assessment(
      where: {
        user_id:  {_eq: $user_id}
        org_id:   {_eq: $org_id}
        tags_str: {_ilike: $tag}
        published_datetime: {_is_null: false}
      }
      order_by: { published_datetime: desc }
      limit: 1
    ) {
      id
      published_assess_id
      name
      published_datetime
    }
  }
`;

// Poll GraphQL until the newly published assessment appears (max ~30s).
export async function findAssessmentByTag(accessToken, userId, orgId, uniqueExamId) {
  const delays = [2000, 3000, 4000, 5000, 5000, 5000, 5000]; // ~29s total

  for (const delay of delays) {
    await new Promise(r => setTimeout(r, delay));

    const res = await fetch(GRAPHQL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: FIND_ASSESSMENT_QUERY,
        variables: { user_id: userId, org_id: orgId, tag: `%${uniqueExamId}%` },
      }),
    });

    const json = await res.json().catch(() => ({}));
    const rows = json?.data?.user_assessment || [];
    if (rows.length > 0 && rows[0].published_assess_id) return rows[0];
  }

  return null;
}

// ── Link helpers ───────────────────────────────────────────────────────────────

export function buildAssessmentLink(publishedAssessId) {
  return `https://assessment.topin.tech/?org_id=${publishedAssessId}&a_t=CLIENT`;
}

export function buildViewUrls(userAssessId) {
  const base = `https://config.topin.tech/view-assessment/${userAssessId}`;
  return {
    viewAssessmentUrl: base,
    viewDetailsUrl:    base.replace("/view-assessment/", "/view-details/"),
  };
}
