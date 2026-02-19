const https = require("https");

// ✅ Your Google Sheet CSV URL directly here
const SHEET_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQD_tVRquK_Nabj2H2LtBSt7nbYEjlN6_VdJrg8gI2UyvO4RhZR85VB7TSNC0Lw7JAhw2c_sblbyw_r/pub?output=csv";

const attempts = {};

function parseCSV(csv) {
  const lines = csv.trim().split("\n").filter(l => l.trim() !== "");
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = "", inQ = false;
    for (let ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return {
      id:     (cols[0] || "").replace(/"/g, "").trim().toUpperCase(),
      name:   (cols[1] || "").replace(/"/g, "").trim(),
      email:  (cols[2] || "").replace(/"/g, "").trim().toLowerCase(),
      course: (cols[3] || "").replace(/"/g, "").trim(),
      date:   (cols[4] || "").replace(/"/g, "").trim()
    };
  }).filter(r => r.id && r.email);
}

function fetchURL(url) {
  return new Promise((resolve, reject) => {
    const get = (targetUrl, redirects = 0) => {
      if (redirects > 5) return reject(new Error("Too many redirects"));
      const lib = targetUrl.startsWith("https") ? https : require("http");
      lib.get(targetUrl, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          return reject(new Error("HTTP " + res.statusCode));
        }
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => resolve(data));
      }).on("error", reject);
    };
    get(url);
  });
}

exports.handler = async (event) => {

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const ip = event.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();

  if (!attempts[ip]) attempts[ip] = { count: 0, reset: now + 60000 };
  if (now > attempts[ip].reset) { attempts[ip] = { count: 0, reset: now + 60000 }; }
  attempts[ip].count++;

  if (attempts[ip].count > 5) {
    return { statusCode: 429, body: JSON.stringify({ error: "Too many attempts. Please wait 1 minute." }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request" }) };
  }

  const { id, email } = body;

  if (!id || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing fields" }) };
  }

  let csvText;
  try {
    csvText = await fetchURL(SHEET_CSV);
  } catch (err) {
    console.error("Sheet fetch error:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Database unavailable. Try again later." }) };
  }

  const records = parseCSV(csvText);
  const match = records.find(
    r => r.id === id.trim().toUpperCase() &&
         r.email === email.trim().toLowerCase()
  );

  if (match) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        verified: true,
        name:   match.name,
        course: match.course,
        date:   match.date,
        certId: match.id
      })
    };
  } else {
    return { statusCode: 200, body: JSON.stringify({ verified: false }) };
  }
};
