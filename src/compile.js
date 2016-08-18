"use strict";
let babel = require('babel-core');
let fs = require('mz/fs');
let path = require('path');
let assert = require('assert');
let _ = require('lodash');
let mkdirP = require('mkdirp');
let _rmrf = require('rimraf');
let debug = require('debug')('babel-compile:compile');

/**
 * This is a library which contains operations useful to tools which compile
 * Javascript to Javascript using the Babel compiler.
 */

// List of file extensions which we'll try to use Babel to compile
const supportedFiles = ['.js', '.jsx'];
const sourceMapSuffix = '.map';

function rmrf(target) {
  return new Promise((res, rej) => {
    _rmrf(target, err => {
      if (err) {
        return rej(err);
      }
      return res(target);
    });
  });
};

/**
 * Run everything which we need in order to do the compilation.  `dirMap` is a
 * list of objects in the shape `{src: ..., dst: ...}`.  The values
 * in `dirMap` items should be paths relative to the current directory.
 * `babelopts` is the configuration object that will be given to
 * `babel-core.transformFile` in order to produce the desired output.  Do note,
 * options relating to source map generation are overwritten by this library
 * before being passed into babel-core.
 */
async function run(dirMap, babelopts, bcopts = {}) {
  assert(dirMap, 'must provide dirMap');
  assert(Array.isArray(dirMap), 'dirMap must be list');
  assert(typeof babelopts === 'object', 'babelopts must be object');

  // Set default options
  let _bcopts = _.defaults({}, bcopts, {
    forceClean: true,
  });

  debug('babel-opts %j', babelopts);
  debug('babel-compile-opts %j', bcopts);

  if (_bcopts.forceClean) {
    console.log('Forcing cleanup');
    await Promise.all(dirMap.map(async pair => {
      if (await fs.exists(pair.dst)) {
        await rmrf(pair.dst);
      }
    }));
  }

  let files = await classifyDirMap(dirMap);
  debug('classified files as:\n%s', JSON.stringify(files, null, 2));

  let allFiles = _.flatten([
    files.com.map(x => x.dst),
    files.cop.map(x => x.dst),
    files.com.map(x => x.dst + sourceMapSuffix),
  ]);
  allFiles.sort();

  let allSourceFiles = _.flatten([
    files.com.map(x => x.src),
    files.cop.map(x => x.src),
  ]);
  allSourceFiles.sort();

  let overlapping = _.intersection(allFiles, allSourceFiles);
  if (overlapping.length > 0) {
    let err = new Error('There are overlapping input and output files');
    err.code = 'InputOutputOverlap';
    err.overlap = overlapping;
    debug('Found overlapping files %j', overlapping);
    throw err;
  }

  let uniqueFiles = _.uniq(allFiles);
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

  // When we're not doing a force clean, we want to make sure that no files exist
  // in the destination directory that we wish to delete
  if (!_bcopts.forceClean) {
    debug('Not forcing clean, finding files that should not be in destination');
    let dstcontents = await listDirectory(dirMap.map(x => x.dst));
    let dirExtra = _.difference(dstcontents.dirs, files.dir);
    let fileExtra = _.difference(dstcontents.files, allFiles);
    debug('removing dirs: %j, files: %j', dirExtra, fileExtra);
    await Promise.all(fileExtra.map(x => fs.unlink(x)));
    await Promise.all(dirExtra.map(x => rmrf(x)));
  }

  // Remember that we should create the directories before we try to write
  // files out to them.  This allows us to skip any checks for directory
  // existance in the copy and compile operations
  await createDirectories(files.dir);
  debug('directory creation finished');

  // Execute our copy and compile operations!
  await Promise.all([
    Promise.all(files.com.map(x => compile(x.src, x.dst, babelopts))),
    Promise.all(files.cop.map(x => copy(x.src, x.dst))),
  ]);
  debug('copy and compile operations complete');
}

function dirMapDstDirs (dirMap) {

}

/**
 * List all files in a directory.  Returns an object with properties `dirs` and
 * `files` 
 */
async function listDirectory(roots) {
  assert(roots);
  assert(Array.isArray(roots));
  let res = {
    files: [],
    dirs: [],
  };

  async function x(y) {
    if ((await fs.lstat(y)).isDirectory()) {
      res.dirs.push(y);
      for (let z of (await fs.readdir(y))) {
        await x(path.join(y, z));
      }
    } else {
      res.files.push(y);
    }
  }

  for (let root of roots) {
    try {
      await fs.lstat(root);
    } catch (err) {
      continue; 
    }
    await x(root);
  }

  return res;
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
    try {
      let dirstat = await fs.lstat(dir);
      if (dirstat && dirstat.isDirectory()) {
        return;
      }
    } catch (err) { }
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

  // We don't care whether the source file is a symlink or not, just
  // as long as it points to a file
  let srcstat = await fs.stat(src);
  assert(srcstat.isFile());

  let dstlstat;

  // If the destination file does not already exist, we should copy the file.  
  try {
    // However, since we *might* encounter symlinks that we've ourselves created
    // we want to operate on *that* symlink, or if not a symlink, we can safely
    // operate on the file
    dstlstat = await fs.lstat(dst);
  } catch (err) { }

  // If the destination already exists, we should either delete it if it's not
  // valid or we should return early if it is
  if (dstlstat) {
    // We should delete directories which are at the destination
    if (dstlstat.isDirectory()) {
      await rmrf(dst);
    }
    
    // Symbolic links should be exactly as this program would create.  I could
    // treat the linked to file as if it were any other file, but that would
    // unfortunately mean that if someone had a weird symlink that was not as
    // I'd create, it would not be recreated.  This could have issues with
    // module publishing
    if (dstlstat.isSymbolicLink()) {
      // If the destination 
      let linkpath = await fs.readlink(dst);
      if (linkpath === path.relative(path.dirname(dst), src)) {
        return;
      };
      // We need to remove this file no matter what
      await fs.unlink(dst);
    }

    // If someone's created a non-file, non-symlink, non-directory in the
    // destination we should get rid of it so we can safely overwrite it
    if (!dstlstat.isFile()) {
      await fs.unlink(dst);
    }

    // Since we already have the inodes of both src and dst, we can short circuit
    // based on that knowledge
    if (srcstat.ino === dstlstat.ino && srcstat.ino !== 0) {
      return;
    }

    // If the destination time is older than the source, we can assume the source
    // has been updated.  The only case I can think of the timestamps being
    // reliably equal is if they're hardlinks, which we've already checked for.
    // Since we know they aren't hardlinks, we can assert that if the timestamps
    // are close enough we should redo the copy
    if (dstlstat.mtime > srcstat.mtime) {
      return;
    } else {
      await fs.unlink(dst);
    }

  }

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
        let ws = fs.createWriteStream(dst, {
          mode: rs.mode,
        });
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
async function compile(src, dst, opts = {}) {
  // For the time being, let's just do the copy
  assert(await fs.exists(src));  
  debug('compiling %s -> %s', src, dst);

  let srcstat = await fs.stat(src);
  let dstlstat;

  assert(srcstat.isFile());

  try {
    dstlstat = await fs.lstat(dst);
  } catch (err) {
  }

  // Unlike copying, we have a much shorter set of conditions for when we're
  // going to not preform the operations
  if (dstlstat) {
    // Basically, delete anything which is not a file since we will only even
    // consider leaving a file around
    if (dstlstat.isDirectory()) {
      await rmrf(dst);
    } else if (!dstlstat.isFile()) {
      await fs.unlink(dst);
    }

    // A hardlink from src to dst is by definition invalid for a compiled file
    // since we know that compiled files are being compiled to change them.
    // Whether the compiler makes a change is not important, but it being a
    // hard link to src invalidates the transformation initiated by this tool.
    if (srcstat.ino === dstlstat.ino && srcstat.ino !== 0) {
      await fs.unlink(dst);
    }

    // If the destination time is older than the source, we can assume the source
    // has been updated.  The only case I can think of the timestamps being
    // reliably equal is if they're hardlinks, which we've already checked for.
    // Since we know they aren't hardlinks, we can assert that if the timestamps
    // are close enough we should redo the copy
    if (dstlstat.mtime > srcstat.mtime) {
      return;
    } else {
      await fs.unlink(dst);
    }  
  }

  // TODO: Verify the order of options and the obj literal.  obj
  // literal must win!
  let _opts = _.defaults({}, {
    sourceMaps: true,
    sourceFileName: path.basename(src),
    sourceMapTarget: path.basename(dst),
    sourceRoot: path.relative(path.dirname(dst), path.dirname(src)),
  }, opts);


  console.log(`Compiling file ${src} --> ${dst}`);
  let start = Date.now();
  let out = await BABELtransformFile(src, _opts);
  console.log(`Finished compiling file ${src} --> ${dst} ${Date.now() - start}ms`);

  // We want to match the permissions of the input
  let fopts = {
    mode: srcstat.mode,
  }

  await Promise.all([
    fs.writeFile(dst, out.code + `\n//# sourceMappingURL=${path.basename(dst)}${sourceMapSuffix}`, fopts),
    fs.writeFile(dst + '.map', JSON.stringify(out.map, null, 2) + '\n', fopts),
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
  __listDirectory: listDirectory,
};
