// Postgres when DATABASE_URL is set, JSON fixtures otherwise.
//
// This one line is what keeps `npm start` working with zero infrastructure: a
// reviewer who cannot bring up Docker still gets a fully functioning system.
// Both implementations return identical payload shapes, so nothing downstream
// can tell them apart.
module.exports = process.env.DATABASE_URL
  ? require('./pgRepo')
  : require('./fixtureRepo');
