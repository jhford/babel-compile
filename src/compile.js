"use strict";
let babel = require('babel-core');
let fs = require('mz/fs');
let path = require('path');
let assert = require('assert');
let _ = require('lodash');
let walk = require('fs-walk');
let mkdirP = require('mkdirp');
let rmrf = require('rimraf');
let debug = require('debug')('babel-compile:compile');

/**
 * This is a library for compiling es6 to node-0.12+ compatible JS.  We wrote
 * this because there are a couple of bugs in the CLI wrapper for babel.  We
 * also wanted to implement a system for sharing babel rules between components
 * through a module.  We do not use es6 to write this script to keep things
 * simple by avoiding any weird bootstrapping issues with Babel
 */

// Prior art, a grunt task for doing babel transpiling: 
//   https://github.com/babel/grunt-babel/blob/master/tasks/babel.js

const supportedFiles = ['.js', '.jsx'];

/**
 * Run all the operations that we wish to do in babel-compile. The dirMap
 * parameter is a a list of objects in the form {src: inDir, dst: outDir}. The
 * babelopts parameter is an object of desired babel-core options.  Keep in
 * mind that we will overwrite some of these to do source maps
 */
async function run(dirMap, babelopts) {
  // Get rid of anything that's there.  I'd rather waste time recreating things
  // than deal with weird files being there and affecting the output.  There's
  // room for improvement by leaving things in place, finding the operations
  // that need to be done and only overwriting the files which have changed,
  // but it'd be critical to remember to delete the files which are no longer
  // in the source directory.  Basically, babel-compile owns getting things
  // right.
  await Promise.all(dirMap.map(async pair => {
    if (await fs.exists(pair.dst)) {
      await new Promise((res, rej) => {
        rmrf(pair.dst, err => {
          if (err) {
            return rej(err);
          }
          return res();
        });
      });
    }
  }));

  let files = await classifyDirMap(dirMap);
  debug('classified files as:\n%s', JSON.stringify(files, null, 2));

  // Remember that we should create the directories before we try to write
  // files out to them.  This allows us to skip any checks for directory
  // existance in the copy and compile operations
  await createDirectories(files.dir);

  // Execute our copy and compile operations!
  await Promise.all([
    files.com.map(x => compile(x.src, x.dst, babelopts)),
    files.cop.map(x => copy(x.src, x.dst)),
  ]);
}

/**
 * Classify all files in the directory map into the directories which must be
 * created, the files which must be copied/linked and the files which must be
 * compiled
 *
 * dirMap is a list of objects {src: inDir, dst: outDir}
 */
async function classifyDirMap(dirMap) {
  assert(typeof dirMap === 'object');

  let res = {
    dir: [],
    cop: [],
    com: [],
  };

  await Promise.all(dirMap.map(async pair => {
    let srcExists = await fs.exists(pair.src);
    assert(srcExists, `missing source directory ${pair.src}`);
    let result = await classifyDirectory(pair.src, pair.dst);
    Array.prototype.push.apply(res.dir, result.dir);
    Array.prototype.push.apply(res.com, result.com);
    Array.prototype.push.apply(res.cop, result.cop);
    res.dir.push(pair.dst);
  }));

  return res;
}

async function classifyDirectory(src, dst) {
  assert(typeof src === 'string');
  assert(typeof dst === 'string');

  let res = {
    dir: [],
    cop: [],
    com: [],
  };

  let dirContent = await fs.readdir(src);

  await Promise.all(dirContent.map(async relSrc => {
    let pair = {
      src: path.join(src, relSrc),
      dst: path.join(dst, relSrc),
    };

    if ((await fs.lstat(pair.src)).isDirectory()) {
      let result = await classifyDirectory(pair.src, pair.dst);
      Array.prototype.push.apply(res.dir, result.dir);
      Array.prototype.push.apply(res.com, result.com);
      Array.prototype.push.apply(res.cop, result.cop);
      res.dir.push(pair.dst);
    } else if (supportedFiles.indexOf(path.parse(pair.src).ext) !== -1) {
      res.com.push(pair);
    } else {
      res.cop.push(pair);
    }
  }));

  return res;
}

/**
 * Create all the directories in a list
 */
async function createDirectories(directories) {
  assert(directories);
  assert(Array.isArray(directories));
  await Promise.all(directories.map(async dir => {
    debug('creating %s', dir);
    assert(typeof dir === 'string');
    console.log(`Creating directory ${dir}`);
    await new Promise((res, rej) => {
      mkdirP(dir, err => {
        if (err) {
          return rej(err);
        }
        return res();
      });
    });
  }));
}

/**
 * Copy or link a file.
 *
 * We try to do a hardlink, then symlink then fallback to copying
 */
async function copy(src, dst) {
  assert(typeof src === 'string');
  assert(typeof dst === 'string');
  debug('copying %s -> %s', src, dst);

  try {
    await fs.link(src, dst);
    console.log(`Hardlinked file ${src} --> ${dst}`);
  } catch (hlerr) {
    try {
      await fs.symlink(src, dst);
      console.log(`Symlinked file ${src} --> ${dst}`);
    } catch (symerr) {
      fs.createReadStream(src).pipe(fs.createWriteStream(dst));
      console.log(`Copied file ${src} --> ${dst}`);
    }
  }
}

/**
 * Wrap babel.transformFile with a promise.  Doing this here in hopes
 * that the upstream babel-core gets promisified and we can just use their
 * promise interface
 */
let BABELtransformFile = async function(filename, opts = {}) {
  return new Promise((res, rej) => {
    babel.transformFile(filename, opts, (err, result) => {
      if (err) {
        return rej(err);
      }
      return res(result);
    });
  });
}

/**
 * Compile a file
 */
async function compile(src, dst, opts) {
  // For the time being, let's just do the copy
  assert(await fs.exists(src));  
  debug('compiling %s -> %s', src, dst);

  // TODO: Verify the order of options and the obj literal.  obj
  // literal must win!
  let _opts = _.defaults({}, opts || {}, {
    sourceMaps: true,
    sourceFileName: path.basename(dst),
    sourceMapTarget: path.basename(dst),
    sourceRoot: path.relative(path.dirname(dst), path.dirname(src)),
  });


  console.log(`Compiling file ${src} --> ${dst}`);
  let start = Date.now();
  let out = await BABELtransformFile(src, _opts);
  console.log(`Finished compiling file ${src} --> ${dst} ${Date.now() - start}ms`);

  let code = out.code + '\n//# sourceMappingURL=' + path.basename(dst) + '.map\n';

  await Promise.all([
    fs.writeFile(dst, out.code + `\n//# sourceMappingURL=${path.basename(dst)}.map`),
    fs.writeFile(dst + '.map', JSON.stringify(out.map, null, 2) + '\n'),
  ]);
}

module.exports = {run, copy, compile, createDirectories};
