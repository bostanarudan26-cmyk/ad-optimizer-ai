// Rulează cu:  node check.js
// Îți arată EXACT de ce nu merge Gemini (cheie, model, limită de cerere).
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("❌ Nu găsesc GEMINI_API_KEY. Creează fișierul .env lângă server.js cu linia: GEMINI_API_KEY=cheia_ta");
  process.exit(1);
}
console.log(`🔑 Cheie găsită (${key.length} caractere)`);

const ai = new GoogleGenAI({ apiKey: key });
const candidati = [
  process.env.GEMINI_MODEL,
  "gemini-3.8-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
].filter(Boolean);

(async () => {
  console.log("\n📋 Modele disponibile pentru cheia ta:");
  try {
    const pager = await ai.models.list();
    for await (const m of pager) {
      const n = (m.name || "").replace("models/", "");
      if (/^gemini/.test(n) && !/embedding|image|tts|live|audio|veo|imagen|robotics/.test(n)) console.log("  -", n);
    }
  } catch (e) {
    console.error("❌ Nu pot lista modelele:", e.status || "", String(e.message).slice(0, 300));
  }

  console.log("\n🧪 Test apel real:");
  for (const model of [...new Set(candidati)]) {
    try {
      const r = await ai.models.generateContent({ model, contents: "Răspunde cu un singur cuvânt: OK" });
      console.log(`✅ ${model} → ${(r.text || "").trim()}`);
    } catch (e) {
      console.log(`❌ ${model} → ${e.status || ""} ${String(e.message).slice(0, 250)}`);
    }
  }
  console.log("\n👉 Pune primul model cu ✅ în .env ca GEMINI_MODEL=...");
})();
