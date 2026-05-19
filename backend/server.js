import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Gemini SDK එක initialize කිරීම (2026 වර්තමාන SDK ශෛලියට අනුව)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// යූසර්ගේ prompt එකෙන් ඩේටා වෙන් කරලා ගන්න endpoint එක
app.post('/api/parse-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // Gemini එකෙන් බලාපොරොත්තු වන JSON ව්‍යුහය (Schema) අර්ථ දැක්වීම
        const extractionSchema = {
            type: Type.OBJECT,
            properties: {
                origin: { 
                    type: Type.STRING, 
                    description: "The starting location extracted from the prompt (e.g., 'Bodima')" 
                },
                destination: { 
                    type: Type.STRING, 
                    description: "The final destination location extracted from the prompt (e.g., 'Pettah')" 
                },
                search_query: { 
                    type: Type.STRING, 
                    description: "The specific shop, brand, or category the user wants to find along the route (e.g., 'P&S', 'pharmacy', 'food shop')" 
                }
            },
            required: ["origin", "destination", "search_query"],
        };

        // Gemini 2.5 Flash මොඩල් එක යූස් කරලා structured output එකක් ගැනීම
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze the following user travel intent (which might be in Singlish or Sinhala) and extract the origin, destination, and the item/place they want to search for along that route. User input: "${prompt}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: extractionSchema,
                systemInstruction: "You are a spatial-aware assistant. Your job is to parse local Sri Lankan travel contexts, processing Singlish/Sinhala phrases into clean search entities.",
            }
        });

        // ලැබුණු JSON string එක parse කරලා frontend එකට යැවීම
        const structuredData = JSON.parse(response.text);
        res.json({ success: true, data: structuredData });

    } catch (error) {
        console.error("Gemini Parsing Error:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`GeoPrompt-Navigator backend running on port ${PORT}`));