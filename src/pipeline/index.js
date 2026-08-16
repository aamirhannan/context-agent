const { run } = require('./runner');
const stages = require('./stages');

module.exports = { run, ...stages };
