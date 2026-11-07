require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json());

// Setăm Multer pentru a stoca imaginile temporar în memorie
const upload = multer({ storage: multer.memoryStorage() });

// Inițializăm Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const MAGIC_PROMPT = `Acționează ca un expert în PR și Brand Safety. Analizează imaginea/textul reclamei atașate. Evaluează riscul ca această reclamă să fie jignitoare, insensibilă sau 'cringe'. Trebuie să returnezi răspunsul tău STRICT ca un obiect JSON valid, fără niciun alt text, formatare markdown sau block-uri de cod. Structura JSON trebuie să fie exact aceasta:
{
"scor_risc": [număr de la 1 la 100],
"explicatie_generala": ["O propoziție scurtă"],
"reactii_audiente": {
"gen_z": ["Reacție tineri"],
"activisti": ["Reacție ONG-uri"],
"parinti": ["Reacție părinți"]
},
"recomandare_salvare": ["Ce trebuie modificat"]
}`;

// Endpoint-ul principal la care frontend-ul va face cererea
app.post('/api/analyze', upload.single('image'), async (req, res) => {
    try {
        const textInput = req.body.text || "";
        const imageFile = req.file;

        if (!textInput && !imageFile) {
            return res.status(400).json({ error: "Te rog să trimiți un text sau o imagine." });
        }

        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        
        let promptContent = [MAGIC_PROMPT];
        
        if (textInput) {
            promptContent.push(`Text reclamă: ${textInput}`);
        }

        if (imageFile) {
            promptContent.push({
                inlineData: {
                    data: imageFile.buffer.toString("base64"),
                    mimeType: imageFile.mimetype
                }
            });
        }

        // Cererea către Gemini
        const result = await model.generateContent(promptContent);
        const responseText = result.response.text();

        // Curățăm răspunsul în caz că Gemini pune ```json la început
        const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const jsonResult = JSON.parse(cleanJson);

        // Trimitem înapoi către frontend
        res.json(jsonResult);

    } catch (error) {
        console.error("Eroare la procesare:", error);
        res.status(500).json({ error: "Eroare la procesarea cererii către AI." });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Backend-ul VibeCheck rulează pe http://localhost:${PORT}`);
});