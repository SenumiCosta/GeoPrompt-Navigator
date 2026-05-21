import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios'; // Axios import කරා
import { GoogleGenAI, Type } from '@google/genai';
import pool from './db.js';
import initDatabase from './initDb.js';

dotenv.config();
    
await initDatabase(); // Initialize the database on startup

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

app.post('/api/parse-prompt', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        // 1. Gemini Layer: Extract Entities
        const extractionSchema = {
            type: Type.OBJECT,
            properties: {
                origin: { type: Type.STRING, description: "Starting location" },
                destination: { type: Type.STRING, description: "Final destination" },
                search_query: { type: Type.STRING, description: "Item or shop category to find" }
            },
            required: ["origin", "destination", "search_query"],
        };

        const aiResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Analyze this user travel intent: "${prompt}"`,
            config: {
                responseMimeType: "application/json",
                responseSchema: extractionSchema,
                systemInstruction: "Extract origin, destination, and search_query from the local Sri Lankan context.",
            }
        });

        const parsedData = JSON.parse(aiResponse.text);
        const { origin, destination, search_query } = parsedData;

        // 2. Maps Layer: Fetch Route from Google Directions API
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json`;
        
        const mapsResponse = await axios.get(directionsUrl, {
            params: {
                origin: origin,
                destination: destination,
                key: GOOGLE_MAPS_API_KEY
            }
        });

        // Google Maps එකෙන් රීටර්න් කරන ඩේටා චෙක් කිරීම
        if (mapsResponse.data.status !== 'OK') {
            return res.status(400).json({ 
                success: false, 
                error: `Google Maps Error: ${mapsResponse.data.status}. Please try specific location names.` 
            });
        }

        // මුළු රූට් එකේම හැරවුම් ලක්ෂ්‍ය නිරූපණය වන Encoded Polyline එකක් ලැබෙනවා
        const routeGeometry = mapsResponse.data.routes[0].overview_polyline.points;
        const duration = mapsResponse.data.routes[0].legs[0].duration.text;
        const distance = mapsResponse.data.routes[0].legs[0].distance.text;

        // 3. Final Response to Frontend
        res.json({
            success: true,
            search_intent: { origin, destination, search_query },
            route: {
                distance: distance,
                duration: duration,
                polyline: routeGeometry // මේක තමයි පස්සේ frontend එකේ map එක උඩ අඳින්නේ
            }
        });

    } catch (error) {
        console.error("Error in Pipeline:", error);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`GeoPrompt-Navigator backend running on port ${PORT}`);
    // සර්වර් එක ස්ටාර්ට් වෙද්දීම ඩේටාබේස් ටේබල්ස් ටික ඔටෝ හැදෙනවා
    await initDatabase(); 
});