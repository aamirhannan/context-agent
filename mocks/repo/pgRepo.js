const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

// Returns the exact payload shapes the assignment specifies, so pgRepo and
// fixtureRepo are interchangeable behind mocks/repo/index.js.
module.exports = {
  name: 'postgres',

  async getUser(id) {
    // Postgres date/time are formatted in SQL, not JS: node-pg hands back a
    // local-midnight Date for `date`, and toISOString() would shift it a day
    // backwards in any timezone east of UTC. `time` needs the seconds trimmed
    // to match the fixture shape.
    const { rows } = await pool.query(
      `select id, name, language, subscription, tone_preference, birth_place,
              to_char(birth_date, 'YYYY-MM-DD') as birth_date,
              to_char(birth_time, 'HH24:MI')    as birth_time
         from users where id = $1`,
      [id],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      name: r.name,
      language: r.language,
      subscription: r.subscription,
      tonePreference: r.tone_preference,
      birthDetails: {
        date: r.birth_date,
        time: r.birth_time,
        place: r.birth_place,
      },
    };
  },

  async getKundli(id) {
    const { rows } = await pool.query('select * from kundli where user_id = $1', [id]);
    if (!rows[0]) return null;
    const k = rows[0];
    const { rows: houseRows } = await pool.query(
      'select house, lord, strength from kundli_houses where user_id = $1 order by house', [id],
    );
    return {
      lagna: k.lagna,
      moonSign: k.moon_sign,
      currentDasha: { mahadasha: k.mahadasha, antardasha: k.antardasha },
      houses: Object.fromEntries(houseRows.map((h) => [String(h.house), { lord: h.lord, strength: h.strength }])),
    };
  },

  async getHoroscope(id, date) {
    const { rows } = await pool.query(
      'select career, finance, health, relationship from horoscope where user_id = $1 and for_date = $2',
      [id, date],
    );
    return rows[0] || null;
  },

  async getPanchang(date) {
    const { rows } = await pool.query(
      'select tithi, nakshatra, yoga, karana from panchang where for_date = $1', [date],
    );
    return rows[0] ? { date, ...rows[0] } : null;
  },

  async close() { await pool.end(); },
};
