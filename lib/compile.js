"use strict";
var babel = require('babel-core');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var _ = require('lodash');
var walk = require('fs-walk');
var mkdirP = require('mkdirp');
var rmrf = require('rimraf').sync;

/**
 * This is a library for compiling es6 to node-0.12+ compatible JS.  We wrote
 * this because there are a couple of bugs in the CLI wrapper for babel.  We
 * also wanted to implement a system for sharing babel rules between components
 * through a module.  We do not use es6 to write this script to keep things
 * simple by avoiding any weird bootstrapping issues with Babel
 */

// Prior art, a grunt task for doing babel transpiling: 
//   https://github.com/babel/grunt-babel/blob/master/tasks/babel.js

var supportedFiles = ['.js', '.jsx'];

function transformDirMapSync(dirMap, options) {
  assert(typeof dirMap === 'object', 'dirMap must be object');
  assert(typeof options === 'object', 'options must be object');

  // We want to have a quick option to empty the output directories if they
  // contain anything.  Because we're doing all compiliations in this one
  // script, it should be safe for us to delete everything already existing in
  // the output dirs
  _.each(dirMap, function(dst, src) {
    assert(typeof src === 'string', 'source directory must be string');
    assert(typeof dst === 'string', 'destination directory must be string');
    assert(fs.existsSync(src), 'source directory must exist');
    if (fs.existsSync(dst)) {
      console.log('Deleting existing destintation: ' + dst);
      rmrf(dst);
      fs.mkdirSync(dst);
    } else {
      fs.mkdirSync(dst);
    }
    transformDirectorySync(src, dst, options);
  });
}

function transformDirectorySync(inDir, outDir, options) {
  assert(typeof inDir === 'string', 'inDir must be a string');
  assert(typeof outDir === 'string', 'outDir must be a string');
  assert(typeof options === 'object', 'options must be an object');
  fs.readdirSync(inDir).forEach(function(inDirMember) {
    var fullInPath = path.join(inDir, inDirMember);
    var fullOutPath = path.join(outDir, inDirMember);
    if (fs.existsSync(fullOutPath)) {
      console.log('Deleting existing destination: ' + fullOutPath);
      rmrf(fullOutPath);
    }
    mkdirP.sync(path.dirname(fullOutPath));
    if (fs.lstatSync(fullInPath).isDirectory()) {
      // We have a dir, let's recurse
      transformDirectorySync(fullInPath, fullOutPath, options);
    } else {
      // We only want to transform files if they are a supported file extension
      // and not in the list of files to ignore
      if (supportedFiles.indexOf(path.parse(fullInPath).ext) !== -1) {
        transformFileSync(fullInPath, fullOutPath, options);
      } else {
        console.log('Copying non-js file ' + fullInPath + ' to ' + fullOutPath);
        fs.writeFileSync(fullOutPath, fs.readFileSync(fullInPath));
      }
    }
  });
}

function transformFileSync(inFile, outCodeFile, options) {
  assert(typeof inFile === 'string', 'inFile must be string');
  assert(fs.existsSync(inFile), 'inFile must exist');
  assert(typeof outCodeFile === 'string', 'outCodeFile must be string');
  assert(typeof options === 'object', 'options must be an object');

  var sourceRelative = path.relative(path.dirname(outCodeFile), inFile);
  // TODO: Verify the order of options and the obj literal.  obj
  // literal must win!
  var fileOpts = _.defaults({}, options || {}, {
    sourceMaps: true,
    sourceFileName: path.basename(outCodeFile),
    sourceMapTarget: path.basename(outCodeFile),
    sourceRoot: path.relative(path.dirname(outCodeFile), path.dirname(inFile)),
  });
  console.log('Compiling file ' + inFile + ' --> ' + outCodeFile);
  var out = babel.transformFileSync(inFile, fileOpts);

  if (fs.existsSync(outCodeFile)) {
    rmrf(outCodeFile);
  }
  mkdirP.sync(path.dirname(outCodeFile));
  var codeOut = out.code + '\n//# sourceMappingURL=' + path.basename(outCodeFile) + '.map\n';
  var mapOut = out.map;
  fs.writeFileSync(outCodeFile, codeOut);
  fs.writeFileSync(outCodeFile + '.map', JSON.stringify(mapOut, null, 2) + '\n');
}

module.exports = {
  transformFileSync: transformFileSync,
  transformDirectorySync: transformDirectorySync,
  transformDirMapSync: transformDirMapSync,
};
