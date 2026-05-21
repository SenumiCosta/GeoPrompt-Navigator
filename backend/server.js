import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import { GoogleGenAI, Type } from '@google/genai';
import polyline from '@mapbox/polyline'; // Mapbox polyline decoder එක
import pool from './db.js';
import initDatabase from './initDb.js';

dotenv.config();

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

        // ==========================================
        // STEP 1: Gemini Layer - Prompt Parsing
        // ==========================================
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
                systemInstruction: "Extract origin, destination, and search_query from local Sri Lankan context.",
            }
        });

        const { origin, destination, search_query } = JSON.parse(aiResponse.text);

        // ==========================================
        // STEP 2: Maps Layer - Fetch Route Polyline
        // ==========================================
        const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json`;
        const mapsResponse = await axios.get(directionsUrl, {
            params: { origin, destination, key: GOOGLE_MAPS_API_KEY }
        });

        if (mapsResponse.data.status !== 'OK') {
            return res.status(400).json({ 
                success: false, 
                error: `Google Maps Error: ${mapsResponse.data.status}. Please try specific location names.` 
            });
        }

        const encodedPolyline = mapsResponse.data.routes[0].overview_polyline.points;
        const duration = mapsResponse.data.routes[0].legs[0].duration.text;
        const distance = mapsResponse.data.routes[0].legs[0].distance.text;

        // ==========================================
        // STEP 3: Geometry Transformation (Polyline to WKT)
        // ==========================================
        // Encoded string එක lat/lng coordinates array එකකට කඩනවා
        const decodedCoords = polyline.decode(encodedPolyline); 
        
        // PostGIS වලට තේරෙන Well-Known Text (WKT) LineString එකක් සාදා ගැනීම
        // Format: LINESTRING(lng1 lat1, lng2 lat2, ...) -> Postgres වලට X=Lng, Y=Lat වේ
        const wktLineString = `LINESTRING(${decodedCoords.map(c => `${c[1]} ${c[0]}`).join(', ')})`;

        // ==========================================
        // STEP 4: Database Layer - Save Route
        // ==========================================
        // දැනට Dummy user_id = 1 ලෙස සලකා රූට් එක DB එකට දානවා
        const routeInsertQuery = `
            INSERT INTO searched_routes (user_id, origin_name, destination_name, route_path)
            VALUES (NULL, $1, $2, ST_GeographyFromText($3))
            RETURNING id;
        `;
        const routeResult = await pool.query(routeInsertQuery, [origin, destination, wktLineString]);
        const savedRouteId = routeResult.rows[0].id;

        // ==========================================
        // STEP 5: Spatial Layer - Live Fetch & Buffer Search
        // ==========================================
        // රූට් එකේ හරියටම මැද ඛණ්ඩාංකය (Center Coordinate) එක ගන්නවා
        const centerIndex = Math.floor(decodedCoords.length / 2);
        const centerLat = decodedCoords[centerIndex][0];
        const centerLng = decodedCoords[centerIndex][1];

        // වඩාත් නිවැරදි Spatial Search එකක් සඳහා Google Nearby Search API එක පාවිච්චි කරමු
        const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json`;
        const placesResponse = await axios.get(placesUrl, {
            params: {
                location: `${centerLat},${centerLng}`, // පාරේ මැද ලක්ෂ්‍යය වටා
                radius: 5000, // කිලෝමීටර් 5ක් ඇතුළත තියෙන හැම එකක්ම අදින්න
                keyword: search_query, // යූසර් සර්ච් කරපු දේ (e.g., 'P&S')
                key: GOOGLE_MAPS_API_KEY
            }
        });

        const incomingPlaces = placesResponse.data.results || [];

        // ලැබුණු Places ටික අපේ `cached_places` එකට Upsert කිරීම
        for (const place of incomingPlaces) {
            const placeWktPoint = `POINT(${place.geometry.location.lng} ${place.geometry.location.lat})`;
            const placeInsertQuery = `
                INSERT INTO cached_places (place_id, name, category, rating, user_ratings_total, formatted_address, location)
                VALUES ($1, $2, $3, $4, $5, $6, ST_GeographyFromText($7))
                ON CONFLICT (place_id) DO UPDATE SET
                    rating = EXCLUDED.rating,
                    user_ratings_total = EXCLUDED.user_ratings_total,
                    updated_at = CURRENT_TIMESTAMP;
            `;
            await pool.query(placeInsertQuery, [
                place.place_id,
                place.name,
                search_query,
                place.rating || 0,
                place.user_ratings_total || 0,
                place.vicinity || place.formatted_address, // Nearby search වල එන්නේ vicinity එක
                placeWktPoint
            ]);
        }

        // ==========================================
        // STEP 6: Core Spatial Query (ST_DWithin)
        // ==========================================
        const spatialSearchQuery = `
            SELECT name, rating, user_ratings_total, formatted_address,
                   ST_Distance(location, route_path) AS distance_from_route,
                   ST_Y(location::geometry) AS lat, -- Geography එක geometry කරලා Latitude (Y) ගන්නවා
                   ST_X(location::geometry) AS lng  -- Geography එක geometry කරලා Longitude (X) ගන්නවා
            FROM cached_places, searched_routes
            WHERE searched_routes.id = $1
              AND cached_places.category = $2
              AND ST_DWithin(location, route_path, 2000) 
            ORDER BY rating DESC, distance_from_route ASC
            LIMIT 5;
        `;
        
        const finalPlacesResult = await pool.query(spatialSearchQuery, [savedRouteId, search_query]);
        
        // 💡 මෙන්න මේ ලයින් එක අනිවාර්යයෙන්ම තියෙන්න ඕනේ!
        const dbPlaces = finalPlacesResult.rows; 

        // ==========================================
        // STEP 7: Gemini Layer 2 - AI Reasoning & Recommendation
        // ==========================================
        let aiRecommendation = "පාර අවට ගැලපෙන ස්ථාන කිසිවක් හමු නොවීය.";
        
        if (dbPlaces.length > 0) {
            const placesContext = dbPlaces.map((p, i) => 
                `${i+1}. Name: ${p.name}, Rating: ${p.rating} (${p.user_ratings_total} reviews), Distance from route: ${Math.round(p.distance_from_route)} meters, Address: ${p.formatted_address}`
            ).join('\n');

            const reasoningResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: `Based on the user's travel route from ${origin} to ${destination} and their query "${search_query}", analyze these discovered places and give a friendly, smart recommendation strictly in Sinhala or friendly local Singlish. Tell them which one is the best option based on high ratings and minimal distance from the route. Do not use markdown bold/stars inside the response text, just keep it plain paragraphs.
                
                Discovered Places:\n${placesContext}`,
                config: {
                    // සිංහලෙන් සහ සිංග්ලිෂ් වලින් විතරක් කතා කරන්න මෙතනින් බල කරමු
                    systemInstruction: "You are a local Sri Lankan tour assistant. Guide the user based on the spatial data provided. You must talk strictly in Sinhala and friendly Sri Lankan Singlish, like a helpful peer explaining a route to a friend.",
                }
            });

            aiRecommendation = reasoningResponse.text;
        }

        // ==========================================
        // STEP 8: Final Response Delivery
        // ==========================================
        res.json({
            success: true,
            meta: {
                origin,
                destination,
                distance,
                duration,
                polyline: encodedPolyline
            },
            ai_analysis: aiRecommendation,
            places_along_route: dbPlaces
        });
    } catch (error) {
        console.error("Error in Spatial Pipeline:", error);
        
        // Gemini එකෙන් 503ක් ආවොත් ඒක ලස්සනට පෙන්වන්න
        if (error.status === 503 || error.code === 503) {
            return res.status(503).json({ 
                success: false, 
                error: "Gemini AI සර්වර් දැනට අධික කාර්යබහුලයි (503). කරුණාකර තත්පර කිහිපයකින් නැවත උත්සාහ කරන්න." 
            });
        }
        
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
    console.log(`GeoPrompt-Navigator backend running on port ${PORT}`);
    await initDatabase();
});