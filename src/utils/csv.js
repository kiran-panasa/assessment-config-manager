// Unified CSV utilities — single source of truth for all CSV parsing and download.
// Previously: 4 duplicate parsers across App.jsx, InvitedStudents.jsx,
// BadgeEligibility.jsx, InterviewerView.jsx; 6 download impls missing revokeObjectURL.

export function parseCSVLine(line) {
  const cells = []; let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

// Returns { headers, col(...keys), rows[] } where each row has get(...keys) → value.
export function parseCSV(text) {
  const lines = text.replace(/\r\n|\r/g, "\n").trim().split("\n");
  if (lines.length < 2) return { headers: [], col: () => -1, rows: [] };
  const headers = parseCSVLine(lines[0]).map(h =>
    h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  );
  const col = (...keys) => keys.map(k => headers.indexOf(k)).find(i => i !== -1) ?? -1;
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const cells = parseCSVLine(line);
    return { get: (...keys) => (cells[col(...keys)] ?? "").trim() };
  });
  return { headers, col, rows };
}

// Generic CSV download. data is string[][] (rows of string values, no escaping needed).
export function downloadCSV(data, headers, filename) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(","), ...data.map(r => r.map(esc).join(","))];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Shared between StudentBookings and InvitedStudents (was duplicated verbatim).
export function parseSessionSkillLevel(title) {
  if (!title) return { skill: "", level: "" };
  const m = title.match(/^(.*?)\s*-\s*(L\d+)$/i);
  return m
    ? { skill: m[1].trim(), level: m[2].toUpperCase() }
    : { skill: title.trim(), level: "" };
}
