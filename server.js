'use strict';

var Starter = require('./lib/loader/starter');
var server = new Starter();

server.start("settings/default.json");