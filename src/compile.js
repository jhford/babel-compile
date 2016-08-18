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
 * This is a library which contains operations useful to tools which compile
 * Javascript to Javascript using the Babel compiler.
 */

// List of file extensions which we'll try to use Babel to compile
const supportedFiles = ['.js', '.jsx'];
const sourceMapSuffix = '.map';

/**
 * Run everything which we need in order to do the compilation.  `dirMap` is a
 * list of objects in the shape `{src: ..., dst: ...}`.  The values
 * in `dirMap` items should be paths relative to the current directory.
 * `babelopts` is the configuration object that will be given to
 * `babel-core.transformFile` in order to produce the desired output.  Do note,
 * options relating to source map generation are overwritten by this library
 * before being passed into babel-core.
 */
async function run(dirMap, babelopts = {}) {
  assert(dirMap, 'must provide dirMap');
  assert(Array.isArray(dirMap), 'dirMap must be list');
  assert(typeof babelopts === 'object', 'babelopts must be object');
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

  debug('directory creation finished');
  // TODO: Check for dupes in the list of copy and compile files

  let allFiles = _.flatten([
    files.com.map(x => x.dst),
    files.cop.map(x => x.dst),
    files.com.map(x => x.dst + sourceMapSuffix),
  ]);

  let allFilesUniq = _.uniq(allFiles);
  if (allFiles.length !== _.uniq(allFiles).length) {
    // We need to sort so we can do the comparisons
    allFiles.sort();
    let dupes = [];
    for (let i = 1 ; i < allFiles.length ; i++) {
      if (allFiles[i] === allFiles[i - 1]) {
        dupes.push(allFiles[i]);
      }
    }
    let err = new Error('There are duplicate files, or sourcemaps would overwrite another file');
    err.code = 'FoundDuplicates';
    err.dupes = dupes;
    debug('Found duplicate files %j', dupes); 
    throw err;
  }

  // Execute our copy and compile operations!
  await Promise.all([
    Promise.all(files.com.map(x => compile(x.src, x.dst, babelopts))),
    Promise.all(files.cop.map(x => copy(x.src, x.dst))),
  ]);
  debug('copy and compile operations complete');
}

/**
 * Classify things in the given `dirMap` into the directories to create, files
 * to copy and files to compile.  Dir map is a list of input and output
 * pairings.
 *
 * `dirMap` is a list of objects {src: ..., dst: ...}
 * 
 * Returns a list like:
 * [
 *    {dir: [], cop: {src: ..., dst:...}, com: {src: ..., dst: ...}}
 * ]
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
  }));

  return res;
}

/**
 * Classify the files from a single source `src` location into
 * a single destination `dst` location.
 *
 * Returns a list like:
 * [
 *    {dir: [], cop: {src: ..., dst:...}, com: {src: ..., dst: ...}}
 * ]
 */
async function classifyDirectory(src, dst) {
  assert(typeof src === 'string');
  assert(typeof dst === 'string');

  let res = {
    dir: [],
    cop: [],
    com: [],
  };

  // We want to be able to compile a single file as well as directories
  if ((await fs.lstat(src)).isDirectory()) {
    res.dir.push(dst);
  } else {
    let pair = {src: src, dst: dst};
    if (isJs(src)) {
      res.com.push(pair);
    } else {
      res.cop.push(pair);
    }
    return res;
  }

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
    } else if (isJs(pair.src)) {
      res.com.push(pair);
    } else {
      res.cop.push(pair);
    }
  }));

  return res;
}

function isJs (filename) {
  return supportedFiles.indexOf(path.parse(filename).ext) !== -1
}

/**
 * Create all directories in the list `directories`
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
 * Copy or link a file.  This function first tries to create a hardlink.  If
 * hardlinking fails for any reason, we try to create a symlink.  If both
 * symbolic and hard linking fail, we try to copy the file.
 *
 * Note: I never tested this on windows because I sort of just don't care about
 * windows.  I passed in the symlink type of 'file' hoping it's the right
 * thing.  If you know windows feel free to fix!
 *
 * Note: I figured it was faster to just try various linking options instead of
 * trying to inpect what they are before attempting.  My suspicion is that the
 * amount of time spent inspecting before attemping on platforms which I care
 * about is longer than the time that it would take to just try two simple
 * syscalls.  A better control flow with options to skip a specific option
 * could be cool.  Maybe do things like skip all types of linking on Windows
 * because I don't really understand that behaviour
 */
async function copy(src, dst) {
  assert(typeof src === 'string');
  assert(typeof dst === 'string');
  debug('copying or linking %s -> %s', src, dst);

  try {
    debug('hardlinking %s -> %s', src, dst);
    await fs.link(src, dst);
    console.log(`Hardlinked file ${src} --> ${dst}`);
  } catch (hlerr) {
    debug('hardlink failed, trying symlink %s', hlerr.stack || hlerr);
    try {
      debug('symlinking %s -> %s', src, dst);
      await fs.symlink(path.relative(path.dirname(dst), src), dst, 'file');
      console.log(`Symlinked file ${src} --> ${dst}`);
    } catch (symerr) {
      debug('hardlink, symlink failed, copying %s', symerr.stack || symerr);
      return new Promise((res, rej) => {
        let rs = fs.createReadStream(src);
        let ws = fs.createWriteStream(dst);
        let readErr;
        let writeErr;

        rs.on('end', () => {
          if (readErr) {
            debug('read error');
            rej(readErr);
          }
          
          if (writeErr) {
            debug('write error');
            rej(writeErr);
          }
          console.log(`Copied file ${src} --> ${dst}`);
          res();
        });

        rs.once('error', err => {
          readErr = err;
        });

        ws.once('error', err => {
          writeErr = err;
        });

        rs.pipe(ws);

      });
    }
  }
}

/**
 * Wrap babel.transformFile with a promise.  Doing this here in hopes
 * that the upstream babel-core gets promisified and we can just use their
 * promise interface.  I didn't really feel like depending on a full promise
 * library to use a single denodify call for such a simple function.
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
 * Compile a file located at `src` and write it out to `dst`.  A second file
 * called `dst + '.map'` will also be written out to.  The options `opts` are
 * what will be passed through to babel-core.  Note that options related to
 * source maps are overwritten in this function in order to ensure that source
 * maps are generated correctly.
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

  await Promise.all([
    fs.writeFile(dst, out.code + `\n//# sourceMappingURL=${path.basename(dst)}.${sourceMapSuffix}`),
    fs.writeFile(dst + '.map', JSON.stringify(out.map, null, 2) + '\n'),
  ]);
}

module.exports = {
  run,
  copy,
  compile,
  createDirectories,
  __classifyDirMap: classifyDirMap,
  __classifyDirectory: classifyDirectory,
  __createDirectories: createDirectories,
  __copy: copy,
  __compile: compile,
};
