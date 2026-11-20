const NOTION_VERSION = "2022-06-28";
const plain = (rich = []) => rich.map((t) => t.plain_text).join("");

module.exports = async function handler(req, res) {
  const token = process.env.NOTION_TOKEN;
  const db = (req.query.db || process.env.DEFAULT_DB_ID || "").replace(/-/g, "");
  const showAll = req.query.all === "1";
  if (!token) return res.status(500).json({ error: "NOTION_TOKEN ontbreekt in Vercel" });
  if (!db) return res.status(400).json({ error: "Geef ?db=<database-id> mee" });
  try {
    let rows = [];
    let cursor;
    for (let i = 0; i < 4; i++) {
      const r = await fetch("https://api.notion.com/v1/databases/" + db + "/query", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: JSON.stringify({
          page_size: 100,
          start_cursor: cursor,
          filter: { and: [
            { property: "Multi-select", multi_select: { contains: "Instagram" } },
            { property: "Date", date: { is_not_empty: true } },
          ] },
          sorts: [{ property: "Date", direction: "descending" }],
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
      const files = (pr["Content"]?.files || []).map((f) => ({
        url: f.type === "file" ? f.file.url : f.external.url,
        name: f.name,
      }));
      return {
        id: p.id,
        title: plain(byType("title")?.title),
        caption: plain(byName("caption")?.rich_text),
        extra: plain(byName("extra info")?.rich_text),
        format: pr["Format"]?.select?.name || "",
        status: byType("status")?.status?.name || "",
        date: pr["Date"]?.date?.start || "",
        files,
      };
    });
    if (!showAll) posts = posts.filter((p) => p.files.length > 0);
    posts = posts.slice(0, 60);
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ posts });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
