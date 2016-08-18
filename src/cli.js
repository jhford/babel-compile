#!/usr/bin/env node
let compile = require('./compile');
let program = require('commander');
let pkgjson = require('../package.json');
let path = require('path');
let _ = require('lodash');
let fs = require('mz/fs');

require('source-map-support').install();

process.on('unhandledRejection', err => {
  process.nextTick(() => {throw err});
});

/**
 * The goal is to add the absolute minimum amount of options that are
 * unique to this program.  If a feature is good enough for one component
 * it ought to be good enough for all.  Babel features are not included in this
 * and will be passed through to Babel without complaint.  This is just options
 * to *this* file itself
 */

let config = {
  presets: [],
  babelrc: false,
};

function addConfig(preset) {
  preset = 'babel-preset-' + preset;
  console.log('Adding preset: ' +  preset);
  config.presets.push(preset);
}

program
  .version(pkgjson.version)
  .option('-C, --no-clean', 'Add bbq sauce')
  .option('-p, --preset [modulename]',
      'Specifies which babel-preset to use', addConfig, [])
  .parse(process.argv);

let mapping = program.args.map(arg => {
  let x = arg.split(':');
  if (x.length !== 2) {
    console.error('Arguments must be in the form src:dst, not ' + arg);
    process.exit(1);
  }
  return {src: x[0], dst: x[1]};
});

console.log('Running babel compilation with config:\n' +
            JSON.stringify(config, null, 2));
// Consider writing the config to .babelrc implicitly
// so that babel-node implicitly uses the same config
// as babel-compile

compile.run(mapping, config, {
  forceClean: program.clean,
}).then(() => {
  console.log('Success!');
  process.exit(0);
}, err => {
  if (err.code === 'FoundDuplicates') {
    console.error([
      'Found duplicate files.  If one of these is a source ',
      'map file (e.g. ends in .map), you likely have a stray ',
      'source map file in your input directory that would ',
      'eroneously overwritten by by the babel-compile source ',
      'map generation step.  You will need to rename either ',
      'the source map, or the javascript file which would have ',
      'a source map with a conflicting name',
    ].join('\n'));
    console.error('Here are the files which confict:\n  * ' + err.dupes.join('\n  * '));
    process.exit(1);
  } else if (err.code === 'InputOutputOverlap') {
    console.error([
      'Found input and output files which overlap.  All of your output ',
      'and input should be completely seperate',
    ].join('\n'));
    console.error('Here are the files which overlap:\n  * ' + err.overlap.join('\n  * '));
    process.exit(1);
  }
  console.error('Error!');
  console.error(err.stack || err);
  process.exit(1);
});
