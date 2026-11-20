const crypto = require("crypto");
const norm = (db) => String(db || "").replace(/-/g, "").toLowerCase();
const keyFor = (db) =>
  crypto.createHmac("sha256", process.env.SWAP_SECRET || "").update(norm(db)).digest("hex").slice(0, 16);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const keyOk = (db, key) => !!process.env.SWAP_SECRET && !!key && safeEq(keyFor(db), key);
module.exports = { keyFor, keyOk, safeEq, norm };
