const users = require('../fixtures/users.json');
const kundli = require('../fixtures/kundli.json');
const horoscope = require('../fixtures/horoscope.json');
const panchang = require('../fixtures/panchang.json');

module.exports = {
  name: 'fixtures',
  async getUser(id) { return users[id] || null; },
  async getKundli(id) { return kundli[id] || null; },
  async getHoroscope(id) { return horoscope[id] || null; },
  async getPanchang(date) { return { date, ...panchang }; },
};
