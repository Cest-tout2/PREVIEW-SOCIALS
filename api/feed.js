const { viewOk } = require("../lib/key");
const NOTION_VERSION = "2022-06-28";
const plain = (rich = []) => rich.map((t) => t.plain_text).join("");

// Zoekt de tabel "PROFIEL & HOOGTEPUNTEN" op dezelfde pagina als de kalender.
async function loadProfile(parent, H) {
  const get = async (u) => { const r = await fetch("https://api.notion.com/v1/" + u, { headers: H }); if (!r.ok) throw new Error("x"); return r.json(); };
  let p = parent, pageId = null;
  for (let i = 0; i < 6 && p; i++) {
    if (p.type === "page_id") { pageId = p.page_id; break; }
    if (p.type !== "block_id") return null;
    p = (await get("blocks/" + p.block_id)).parent;
  }
  if (!pageId) return null;
  const isProf = (b) => b.type === "child_database" && /profiel/i.test(b.child_database.title || "");
  let kids = (await get("blocks/" + pageId + "/children?page_size=100")).results;
  let found = kids.find(isProf);
  for (const b of kids) {
    if (found) break;
    if (b.type !== "column_list") continue;
    for (const c of (await get("blocks/" + b.id + "/children")).results) {
      found = (await get("blocks/" + c.id + "/children")).results.find(isProf);
      if (found) break;
    }
  }
  if (!found) return null;
  const q = await fetch("https://api.notion.com/v1/databases/" + found.id + "/query", { method: "POST", headers: H, body: JSON.stringify({ page_size: 50 }) });
  if (!q.ok) return null;
  const rows = (await q.json()).results;
  const val = (pr, n) => Object.entries(pr).find(([k]) => k.trim().toLowerCase() === n)?.[1];
  const img = (pr) => { const f = (val(pr, "afbeelding")?.files || [])[0]; return f ? (f.type === "file" ? f.file.url : f.external.url) : (val(pr, "link afbeelding")?.url || ""); };
  const num = (pr, n) => { const v = val(pr, n); return v && typeof v.number === "number" ? v.number : null; };
  const txt = (pr, n) => plain(val(pr, n)?.rich_text);
  const title = (pr) => plain(Object.values(pr).find((v) => v.type === "title")?.title);
  const type = (pr) => val(pr, "type")?.select?.name || "";
  const prof = rows.find((r) => /profiel/i.test(type(r.properties)));
  const highlights = rows.filter((r) => /hoogtepunt/i.test(type(r.properties)))
    .sort((a, b) => (num(a.properties, "volgorde") ?? 99) - (num(b.properties, "volgorde") ?? 99))
    .map((r) => ({ name: title(r.properties), img: img(r.properties) }));
  const pr = prof ? prof.properties : {};
  return {
    name: prof ? title(pr) : "",
    username: prof ? txt(pr, "gebruikersnaam") : "",
    bio: prof ? txt(pr, "bio") : "",
    photo: prof ? img(pr) : "",
    posts: prof ? num(pr, "berichten") : null,
    followers: prof ? num(pr, "volgers") : null,
    following: prof ? num(pr, "volgend") : null,
    highlights,
  };
}

module.exports = async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const db = (req.query.db || process.env.DEFAULT_DB_ID || "").replace(/-/g, "");
  const showAll = req.query.all === "1";
  if (!viewOk(db, req.query.vk, req.query.key)) return res.status(401).json({ error: "Deze link is niet geldig. Vraag een nieuwe link aan het team." });
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN ontbreekt in Vercel" });
  if (!db) return res.status(400).json({ error: "Geef ?db=<database-id> mee" });
  const H = { Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" };
  try {
    // Zoek de juiste kolommen op type, zodat elke klantkalender werkt (Multi-select / Kanaal, "Format " met spatie, ...)
    const sr = await fetch("https://api.notion.com/v1/databases/" + db, { headers: H });
    const schema = await sr.json();
    if (!sr.ok) return res.status(sr.status).json({ error: schema.message || "Notion-fout" });
    const props = Object.entries(schema.properties);
    const isIG = (o) => /instagram/i.test(o.name);
    const channel = props.find(([, v]) => v.type === "multi_select" && (v.multi_select.options || []).some(isIG));
    const dateProp = props.find(([k, v]) => v.type === "date" && k.trim().toLowerCase() === "date") || props.find(([, v]) => v.type === "date");
    if (!dateProp) return res.status(400).json({ error: "Deze kalender heeft geen datumkolom." });
    const igName = channel ? channel[1].multi_select.options.find(isIG).name : null;
    const filters = [{ property: dateProp[0], date: { is_not_empty: true } }];
    if (channel) filters.push({ property: channel[0], multi_select: { contains: igName } });

    let rows = [];
    let cursor;
    for (let i = 0; i < 4; i++) {
      const r = await fetch("https://api.notion.com/v1/databases/" + db + "/query", {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          page_size: 100,
          start_cursor: cursor,
          filter: { and: filters },
          sorts: [{ property: dateProp[0], direction: "descending" }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.message || "Notion-fout" });
      rows = rows.concat(data.results);
      if (!data.has_more) break;
      cursor = data.next_cursor;
    }
    let posts = rows.map((p) => {
      const pr = p.properties;
      const byName = (n) => Object.entries(pr).find(([k]) => k.trim().toLowerCase() === n)?.[1];
      const byType = (t) => Object.values(pr).find((v) => v.type === t);
      const files = (byName("content")?.files || []).map((f) => ({
        url: f.type === "file" ? f.file.url : f.external.url,
        name: f.name,
      }));
      return {
        id: p.id,
        title: plain(byType("title")?.title),
        caption: plain(byName("caption")?.rich_text),
        extra: plain(byName("extra info")?.rich_text),
        format: byName("format")?.select?.name || "",
        status: byType("status")?.status?.name || "",
        date: pr[dateProp[0]]?.date?.start || "",
        dateObj: pr[dateProp[0]]?.date || null,
        files,
      };
    });
    if (!showAll) posts = posts.filter((p) => p.files.length > 0);
    posts = posts.slice(0, 60);
    let profile = null;
    try { profile = await loadProfile(schema.parent, H); } catch (e) { profile = null; }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ posts, profile });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
