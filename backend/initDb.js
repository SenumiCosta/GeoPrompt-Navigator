import pool from './db.js';

const initDatabase = async () => {
    const createTablesQuery = `
        -- 1. PostGIS Extension එක ඔන් කිරීම (ඩොකර් එකේ දැනටමත් තිබ්බත් ෂුවර් එකටම රන් කරනවා)
        CREATE EXTENSION IF NOT EXISTS postgis;

        -- 2. Users Table
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 3. Searched Routes Table (පාරවල් සේව් කරන්න)
        CREATE TABLE IF NOT EXISTS searched_routes (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id) ON DELETE CASCADE,
            origin_name VARCHAR(255) NOT NULL,
            destination_name VARCHAR(255) NOT NULL,
            route_path GEOGRAPHY(LineString, 4326), 
            searched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 4. Cached Places Table (කඩවල් සේව් කරන්න)
        CREATE TABLE IF NOT EXISTS cached_places (
            id SERIAL PRIMARY KEY,
            place_id VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(100),
            rating NUMERIC(2,1),
            user_ratings_total INT,
            formatted_address TEXT,
            location GEOGRAPHY(Point, 4326), 
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- 5. Spatial Indexes (ඩේටා සර්ච් එක සුපිරියටම ස්පීඩ් කරන්න මේවා අනිවාර්යයි)
        CREATE INDEX IF NOT EXISTS idx_places_location ON cached_places USING GIST (location);
        CREATE INDEX IF NOT EXISTS idx_routes_path ON searched_routes USING GIST (route_path);
    `;

    try {
        await pool.query(createTablesQuery);
        console.log(' PostGIS Tables and Spatial Indexes initialized successfully!');
    } catch (error) {
        console.error(' Error initializing database tables:', error);
    }
};

export default initDatabase;
