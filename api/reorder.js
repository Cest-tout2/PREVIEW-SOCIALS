const { keyOk, norm } = require("../lib/key");
const V = "2022-06-28";
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST vereist" });
  const token = process.env.NOTION_TOKEN;
  const { db, key, updates } = req.body || {};
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN ontbreekt" });
  if (!keyOk(db, key)) return res.status(401).json({ error: "Geen toegang om aan te passen" });
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 40)
    return res.status(400).json({ error: "Ongeldige wijzigingen" });
  const H = { Authorization: "Bearer " + token, "Notion-Version": V, "Content-Type": "application/json" };
  try {
    for (const u of updates) {
      if (!u || !/^[0-9a-f-]{32,36}$/i.test(u.id) || !u.date || !/^\d{4}-\d{2}-\d{2}/.test(u.date.start || ""))
        return res.status(400).json({ error: "Ongeldige post of datum" });
      const r = await fetch("https://api.notion.com/v1/pages/" + u.id, { headers: H });
      const p = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: p.message || "Notion-fout" });
      if (norm(p.parent?.database_id) !== norm(db)) return res.status(403).json({ error: "Post hoort niet bij deze kalender" });
    }
    for (const u of updates) {
      const date = { start: u.date.start, end: u.date.end || null, time_zone: u.date.time_zone || null };
      const r = await fetch("https://api.notion.com/v1/pages/" + u.id, {
        method: "PATCH", headers: H, body: JSON.stringify({ properties: { Date: { date } } }),
      });
      const d = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: d.message || "Notion-fout bij opslaan" });
    }
    return res.status(200).json({ ok: true, changed: updates.length });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
