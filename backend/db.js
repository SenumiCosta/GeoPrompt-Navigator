import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// කනෙක්ෂන් එක සාර්ථකද කියලා චෙක් කරන්න පොඩි ටෙස්ට් එකක්
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database Connection Error:', err);
    } else {
        console.log('🐘 PostGIS Database Connected Successfully at:', res.rows[0].now);
    }
});

export default pool;