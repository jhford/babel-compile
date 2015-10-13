#!/usr/bin/env node
var babel = require('./compile');
var program = require('commander');
var pkgjson = require('../package.json');
var path = require('path');
var _ = require('lodash');


/**
 * The goal is to add the absolute minimum amount of options that are
 * unique to this program.  If a feature is good enough for one component
 * it ought to be good enough for all.  Babel features are not included in this
 * and will be passed through to Babel without complaint.  This is just options
 * to *this* file itself
 */

var config = {};
function addConfig(cfg) {
  var module;

  try {
    module = require(cfg);
  } catch (err) {
    try {
      module = require(path.join(process.cwd(), cfg));
    } catch (err2) {
      console.error('Configuration file or module cannot be resolved: ' + cfg);
      process.exit(1);
    }
  }

  console.log('Loading configuration from: ' + cfg);
  _.merge(config, module);
}

program
  .version(pkgjson.version)
  .option('-c, --config-module [modulename]',
      'node module which exports a bable configuration object.' +
      '  This value is require()\'d and used verbatim.', addConfig, [])
  .parse(process.argv);

var mapping = {};
var options = {};

program.args.forEach(function(arg) {
  var x = arg.split(':');
  if (x.length !== 2) {
    console.error('Arguments must be in the form src:dst, not ' + arg);
    process.exit(1);
  }
  mapping[x[0]] = x[1];
});

console.log('Running babel compilation with config:\n' +
            JSON.stringify(config, null, 2));

babel.transformDirMapSync(mapping, config);
