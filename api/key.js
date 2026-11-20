const { keyFor, safeEq, norm } = require("../lib/key");
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST vereist" });
  const { secret, db } = req.body || {};
  if (!process.env.SWAP_SECRET || !secret || !safeEq(secret, process.env.SWAP_SECRET))
    return res.status(401).json({ error: "Verkeerd wachtwoord" });
  if (!norm(db)) return res.status(400).json({ error: "Geen database-ID" });
  return res.status(200).json({ key: keyFor(db) });
};
