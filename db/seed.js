require('dotenv').config();
const { Client } = require('pg');
const users = require('../mocks/fixtures/users.json');
const kundli = require('../mocks/fixtures/kundli.json');
const horoscope = require('../mocks/fixtures/horoscope.json');
const panchang = require('../mocks/fixtures/panchang.json');

const DAYS = 30;

const dateOffset = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  for (const u of Object.values(users)) {
    await client.query(
      `insert into users (id, name, language, subscription, tone_preference, birth_date, birth_time, birth_place)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
      [u.id, u.name, u.language, u.subscription, u.tonePreference, u.birthDetails.date, u.birthDetails.time, u.birthDetails.place],
    );
  }

  for (const [userId, k] of Object.entries(kundli)) {
    await client.query(
      `insert into kundli (user_id, lagna, moon_sign, mahadasha, antardasha)
       values ($1,$2,$3,$4,$5) on conflict (user_id) do nothing`,
      [userId, k.lagna, k.moonSign, k.currentDasha.mahadasha, k.currentDasha.antardasha],
    );
    for (const [house, v] of Object.entries(k.houses)) {
      await client.query(
        `insert into kundli_houses (user_id, house, lord, strength)
         values ($1,$2,$3,$4) on conflict (user_id, house) do nothing`,
        [userId, Number(house), v.lord, v.strength],
      );
    }
  }

  // A month either side so temporal questions have real data.
  for (const [userId, h] of Object.entries(horoscope)) {
    for (let n = -DAYS; n <= DAYS; n += 1) {
      await client.query(
        `insert into horoscope (user_id, for_date, career, finance, health, relationship)
         values ($1,$2,$3,$4,$5,$6) on conflict (user_id, for_date) do nothing`,
        [userId, dateOffset(n), h.career, h.finance, h.health, h.relationship],
      );
    }
  }

  for (let n = -DAYS; n <= DAYS; n += 1) {
    await client.query(
      `insert into panchang (for_date, tithi, nakshatra, yoga, karana)
       values ($1,$2,$3,$4,$5) on conflict (for_date) do nothing`,
      [dateOffset(n), panchang.tithi, panchang.nakshatra, panchang.yoga, panchang.karana],
    );
  }

  const { rows } = await client.query('select count(*)::int as n from users');
  console.log(`seeded — ${rows[0].n} users, ${DAYS * 2 + 1} days of horoscope and panchang`);
  await client.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
