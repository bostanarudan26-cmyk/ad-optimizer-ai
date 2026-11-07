require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { GoogleGenAI } = require("@google/genai");

// ───────────────────────── CONFIG ─────────────────────────
const PORT = process.env.PORT || 5000;
const API_KEY = process.env.GEMINI_API_KEY;
// true = dacă Gemini crapă, trimitem date mock (bun pentru demo live). Pune MOCK_ON_ERROR=false în .env ca să vezi erorile reale.
const MOCK_ON_ERROR = process.env.MOCK_ON_ERROR !== "false";

// Încearcă modelele în ordine. Dacă setezi GEMINI_MODEL în .env, acela e primul.
// Rulează `node check.js` ca să vezi ce modele merg cu cheia TA și pune-l pe primul în GEMINI_MODEL.
const MODELE = [
  ...new Set(
    [
      process.env.GEMINI_MODEL,
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-2.5-flash",
    ].filter(Boolean)
  ),
];

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;
let modelActiv = null; // ținem minte ultimul model care a mers

const AUDIENTE = [
  { id: "gen_z", nume: "Generația Z (18-25 ani)" },
  { id: "millennials", nume: "Millennials (26-40 ani)" },
  { id: "parinti", nume: "Părinți" },
  { id: "activisti", nume: "Activiști Sociali" },
  { id: "corporatisti", nume: "Corporatiști / B2B" },
];

// ───────────────────────── PROMPT ─────────────────────────
const PROMPT = `Acționează ca un expert în PR, Brand Safety și analiză socială, pentru piața din România și Europa.
Analizează reclama primită (imagine și/sau text) și evaluează riscul ca ea să fie jignitoare, insensibilă, stereotipică sau "cringe" și să declanșeze un scandal de PR (cancel culture).

Reguli:
- Răspunde EXCLUSIV cu un obiect JSON valid, fără text în afara lui și fără markdown.
- Scrie toate textele în limba română.
- Scorurile sunt numere întregi de la 0 la 100 (100 = dezastru de PR).
- Fiecare "reactie" are maximum 2 propoziții, concrete, legate de ce se vede sau se citește în reclamă.
- "sentiment" este exact una dintre valorile: "Pozitiv", "Neutru", "Critic", "Negativ", "Foarte Negativ".
- "ce_trebuie_schimbat" conține 3 sau 4 recomandări concrete și acționabile.
- Dacă materialul nu e o reclamă, analizează-l oricum ca pe un mesaj de brand.

Structura JSON trebuie să fie exact aceasta:
{
  "scor_risc": 0,
  "rezumat_problema": "O propoziție scurtă despre problema principală",
  "categorii_sociale": [
${AUDIENTE.map(
  (a) => `    { "id": "${a.id}", "risc": 0, "sentiment": "Neutru", "reactie": "Reacția: ${a.nume}" }`
).join(",\n")}
  ],
  "ce_trebuie_schimbat": ["Recomandare 1", "Recomandare 2", "Recomandare 3"]
}`;

// ───────────────────────── HELPERI ─────────────────────────
const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function nivelDinScor(s) {
  if (s >= 75) return "CRITIC";
  if (s >= 50) return "RIDICAT";
  if (s >= 25) return "MEDIU";
  return "SCĂZUT";
}

// Scoate JSON-ul chiar dacă modelul a băgat ```json sau text în jur
function extrageJson(text) {
  if (!text) throw new Error("Răspuns gol de la Gemini (posibil blocat de filtrele de siguranță)");
  const curat = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = curat.indexOf("{");
  const end = curat.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Gemini nu a returnat JSON: " + curat.slice(0, 200));
  return JSON.parse(curat.slice(start, end + 1));
}

// Garantează că frontend-ul primește MEREU aceeași structură, cu 5 audiențe în aceeași ordine
function normalizeaza(j) {
  const scor = clamp(j.scor_risc);
  const lista = Array.isArray(j.categorii_sociale) ? j.categorii_sociale : [];
  return {
    scor_risc: scor,
    nivel: nivelDinScor(scor),
    rezumat_problema: String(j.rezumat_problema || "").trim() || "Nu s-a putut genera un rezumat.",
    categorii_sociale: AUDIENTE.map((a) => {
      const g = lista.find((c) => c && c.id === a.id) || {};
      return {
        id: a.id,
        categorie: a.nume,
        risc: clamp(g.risc),
        sentiment: g.sentiment || "Neutru",
        reactie: String(g.reactie || "Fără date pentru această audiență."),
      };
    }),
    ce_trebuie_schimbat: Array.isArray(j.ce_trebuie_schimbat) ? j.ce_trebuie_schimbat.map(String) : [],
  };
}

const MOCK = normalizeaza({
  scor_risc: 78,
  rezumat_problema: "Reclama folosește un ton intens ce poate genera vizibilitate, dar poartă riscuri de PR.",
  categorii_sociale: [
    { id: "gen_z", risc: 85, sentiment: "Negativ", reactie: "Riscă boicot pe TikTok; mesajul e perceput ca 'cringe'." },
    { id: "millennials", risc: 60, sentiment: "Critic", reactie: "Vor considera campania superficială și ușor controversată." },
    { id: "parinti", risc: 75, sentiment: "Foarte Negativ", reactie: "Sunt îngrijorați de mesajul transmis copiilor." },
    { id: "activisti", risc: 90, sentiment: "Critic", reactie: "Vor cere retragerea reclamei pentru lipsă de incluziune." },
    { id: "corporatisti", risc: 25, sentiment: "Neutru", reactie: "Majoritatea o vor ignora; unii o vor distribui ironic." },
  ],
  ce_trebuie_schimbat: [
    "Revizuiți sloganul principal; are conotații duble.",
    "Folosiți imagini mai diverse și incluzive.",
    "Schimbați tonul din arogant în empatic.",
  ],
});

// ───────────────────────── GEMINI ─────────────────────────
async function analizeazaCuGemini({ buffer, mimetype, text }) {
  if (!ai) throw new Error("Lipsește GEMINI_API_KEY din fișierul .env");

  const parts = [];
  if (buffer) parts.push({ inlineData: { mimeType: mimetype, data: buffer.toString("base64") } });
  parts.push({ text: PROMPT + (text ? `\n\nTextul campaniei:\n"""${text}"""` : "") });

  const ordine = modelActiv ? [modelActiv, ...MODELE.filter((m) => m !== modelActiv)] : MODELE;
  let ultimaEroare;

  for (const model of ordine) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: parts,
        config: { responseMimeType: "application/json", temperature: 0.4 },
      });
      const rezultat = normalizeaza(extrageJson(response.text));
      modelActiv = model;
      console.log(`✅ Analiză reușită cu ${model} (scor ${rezultat.scor_risc})`);
      return { ...rezultat, _model: model };
    } catch (err) {
      ultimaEroare = err;
      const status = err.status || err.code;
      const msg = String(err.message || err);
      console.error(`⚠️  [${model}] ${status || ""} ${msg.slice(0, 300)}`);

      // Cheie greșită / fără permisiuni → nu are sens să încercăm alte modele
      if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(msg)) break;
      // altfel (404 model inexistent, 429 limită, 503 aglomerat, JSON prost) → următorul model
    }
  }
  throw ultimaEroare;
}

// ───────────────────────── SERVER ─────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const TIPURI_OK = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) =>
    TIPURI_OK.includes(file.mimetype) ? cb(null, true) : cb(new Error("Format neacceptat. Folosește JPG, PNG sau WEBP.")),
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, cheie_setata: Boolean(API_KEY), modele: MODELE, model_activ: modelActiv });
});

// Câmpuri acceptate (multipart/form-data): "image" (fișier) și/sau "text"
app.post("/api/analyze", upload.single("image"), async (req, res) => {
  const text = ((req.body && req.body.text) || "").trim();
  const file = req.file;

  if (!file && !text) {
    return res.status(400).json({ eroare: "Trimite o imagine (câmpul 'image') sau un text (câmpul 'text')." });
  }

  try {
    const rezultat = await analizeazaCuGemini({
      buffer: file && file.buffer,
      mimetype: file && file.mimetype,
      text,
    });
    res.json(rezultat);
  } catch (error) {
    console.error("❌ Eroare la procesare:", error.message);
    if (MOCK_ON_ERROR) {
      // _mock și _eroare te ajută să știi că ai primit date false
      return res.json({ ...MOCK, _mock: true, _eroare: String(error.message).slice(0, 300) });
    }
    res.status(500).json({ eroare: "Analiza a eșuat.", detalii: String(error.message).slice(0, 300) });
  }
});

// Erori de upload (fișier prea mare, format greșit)
app.use((err, req, res, next) => {
  res.status(400).json({ eroare: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Backend-ul VibeCheck rulează pe http://localhost:${PORT}`);
  console.log(API_KEY ? "🔑 GEMINI_API_KEY găsită" : "❌ GEMINI_API_KEY LIPSEȘTE din .env");
  console.log("🤖 Modele încercate, în ordine:", MODELE.join(" → "));
});
