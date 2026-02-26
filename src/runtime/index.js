// src/runtime/index.js
const { RuntimeAPI, execute } = require('./RuntimeAPI');
const { parse} = require('../parser');

module.exports = { execute, RuntimeAPI, parse };