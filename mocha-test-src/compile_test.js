let sinon = require('sinon');
let mktemp = require('mktemp');
let fs = require('fs');
let path = require('path');
let rmrf = require('rimraf').sync;
let assert = require('assert');
let assume = require('assume');
let mzfs = require('mz/fs');
let exec = require('mz/child_process').exec;
let stream = require('stream');

let subject = require('../lib/compile');

/**
 * This is a dirMap of code that's expected to work always
 */
const sampleMap = [{src: 'sample-in', dst: 'sample-out'}];

/**
 * This is a dirMap that's expected to always fail because there is a shadowed
 * file inside it
 */
const shadowMap = [{src: 'test/source-map-overshadow', dst: 'test/out'}];

describe('compile.js', () => {
  let sandbox;

  before(() => {
    sandbox = sinon.sandbox.create();
  });

  beforeEach(() => {
    rmrf('test-out');
    fs.mkdirSync('test-out');
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(() => {
    rmrf('test-out');
    rmrf('sample-out');
  });

  describe('.run', () => {
    it('should work with good data and no options', async () => {
      rmrf('sample-out');
      await subject.run(sampleMap); 
    });
    
    it('should work with good data and with empty options', async () => {
      rmrf('sample-out');
      await subject.run(sampleMap, {}); 
    });
    
    it('should work with good data and with used options', async () => {
      rmrf('sample-out');
      await subject.run(sampleMap, {
        highlightCode: false
      }); 
    });

    it('should fail with bad data', done => {
      subject.run(shadowMap).then(() => done(new Error()), err => {
        assert(err.code === 'FoundDuplicates');
        done();
      });
    });
  });

  describe('.classifyDirMap', () => {
    it('should classify sample source map', async () => {
      let result = await subject.__classifyDirMap(sampleMap);
      let expected= { dir: 
         [ 'sample-out',
           'sample-out/level2/level3/empty/just-js',
           'sample-out/level2/level3/empty/just-not-js',
           'sample-out/level2/level3/empty',
           'sample-out/level2/level3',
           'sample-out/level2' ],
        cop: 
         [ { src: 'sample-in/notjavascript',
             dst: 'sample-out/notjavascript' },
           { src: 'sample-in/level2/notjavascript2',
             dst: 'sample-out/level2/notjavascript2' },
           { src: 'sample-in/level2/level3/notjavascript3',
             dst: 'sample-out/level2/level3/notjavascript3' },
           { src: 'sample-in/level2/level3/empty/just-not-js/notjavascript4',
             dst: 'sample-out/level2/level3/empty/just-not-js/notjavascript4' } ],
        com: 
         [ { src: 'sample-in/hello.js', dst: 'sample-out/hello.js' },
           { src: 'sample-in/level2/hello2.js',
             dst: 'sample-out/level2/hello2.js' },
           { src: 'sample-in/level2/level3/hello3.js',
             dst: 'sample-out/level2/level3/hello3.js' },
           { src: 'sample-in/level2/level3/empty/just-js/hello4.js',
             dst: 'sample-out/level2/level3/empty/just-js/hello4.js' } ] };

      assume(result.dir.sort()).deeply.equals(expected.dir.sort());
      assume(result.com.sort()).deeply.equals(expected.com.sort());
      assume(result.cop.sort()).deeply.equals(expected.cop.sort());
      assume(result).deeply.equals(expected);
    });
  });

  describe('.classifyDirectory', () => {
    it('should classify a directory', async () => {
      let result = await subject.__classifyDirectory('sample-in', 'hi');
      let expected = { dir: 
         [ 'hi',
           'hi/level2',
           'hi/level2/level3/empty/just-js',
           'hi/level2/level3/empty/just-not-js',
           'hi/level2/level3/empty',
           'hi/level2/level3' ],
        cop: 
         [ { src: 'sample-in/notjavascript', dst: 'hi/notjavascript' },
           { src: 'sample-in/level2/notjavascript2',
             dst: 'hi/level2/notjavascript2' },
           { src: 'sample-in/level2/level3/notjavascript3',
             dst: 'hi/level2/level3/notjavascript3' },
           { src: 'sample-in/level2/level3/empty/just-not-js/notjavascript4',
             dst: 'hi/level2/level3/empty/just-not-js/notjavascript4' } ],
        com: 
         [ { src: 'sample-in/hello.js', dst: 'hi/hello.js' },
           { src: 'sample-in/level2/hello2.js',
             dst: 'hi/level2/hello2.js' },
           { src: 'sample-in/level2/level3/hello3.js',
             dst: 'hi/level2/level3/hello3.js' },
           { src: 'sample-in/level2/level3/empty/just-js/hello4.js',
             dst: 'hi/level2/level3/empty/just-js/hello4.js' } ] };
      assume(result.dir.sort()).deeply.equals(expected.dir.sort());
      assume(result.com.sort()).deeply.equals(expected.com.sort());
      assume(result.cop.sort()).deeply.equals(expected.cop.sort());
      assume(result).deeply.equals(expected);
    });

    it('should classify a single js file', async () => {
      let result = await subject.__classifyDirectory('test/hello.js', 'test/bye.js');
      let expected = {
        dir: [],
        com: [{src: 'test/hello.js', dst: 'test/bye.js'}],
        cop: [],
      };
      assume(result.dir.sort()).deeply.equals(expected.dir.sort());
      assume(result.com.sort()).deeply.equals(expected.com.sort());
      assume(result.cop.sort()).deeply.equals(expected.cop.sort());
      assume(result).deeply.equals(expected);
    });
    
    it('should classify a single non-js file', async () => {
      let result = await subject.__classifyDirectory('test/notajsfile', 'test/notajsfile.out');
      let expected = {
        dir: [],
        com: [],
        cop: [{src: 'test/notajsfile', dst: 'test/notajsfile.out'}],
      };
      assume(result.dir.sort()).deeply.equals(expected.dir.sort());
      assume(result.com.sort()).deeply.equals(expected.com.sort());
      assume(result.cop.sort()).deeply.equals(expected.cop.sort());
      assume(result).deeply.equals(expected);
    });
  });

  describe('.createDirectories', () => {
    it('should create directories', async () => {
      let dirs = [
        'test-out',
        path.join('test-out', '1'),
        path.join('test-out', '1', '2'),
        path.join('test-out', '1', '2'),
        path.join('test-out', '1', '2', '3'),
        path.join('test-out', '1', '2', '3', '4', '5'),
      ];
      dirs.forEach(dir => rmrf(dir));
      await subject.__createDirectories(dirs);
      dirs.forEach(dir => {
        assert(fs.lstatSync(dir).isDirectory());
      });
    });
  });

  describe('.copy', () => {
    let src = 'test/hello.js';
    let dst = 'test-out/hello.out.js';

    it('should hardlink when possible', async () => {
      await subject.__copy(src, dst);
      assume(fs.lstatSync(src).ino).equals(fs.lstatSync(dst).ino);
      // lol windows
      assume(fs.lstatSync(dst).ino).does.not.equals(0);
    });

    it('should symlink when hardlinking fails', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      await subject.__copy(src, dst);
      assert(fs.lstatSync(dst).isSymbolicLink());
    });

    it('should copy when hardlinking and symlinking fail', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));

      await subject.__copy(src, dst);
      assert(!fs.lstatSync(dst).isSymbolicLink());
      assert(fs.lstatSync(dst).isFile());
      assume(fs.readFileSync(src).toString()).equals(fs.readFileSync(dst).toString());
    });

    it.skip('should throw error on read problem', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));
      try {
        await subject.__copy(src, dst);
      } catch (err) { }
    });

    it.skip('should thorw error on write problem', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));
      try {
        await subject.__copy(src, dst);
      } catch (err) { }
    });
  });

  describe('.compile', () => {
    it('should compile without options', async () => {
      await subject.__compile('test/hello.js', 'test-out/hello.out.js');
      let output = await exec(`${process.argv[0]} test-out/hello.out.js`);
      assume(output).deeply.equals([ 'hi\n', '' ]);
    });
    
    it('should generate valid source maps', async () => {
      await subject.__compile('test/throws.js', 'test-out/throws.out.js');
      let output = await exec(`${process.argv[0]} test-out/throws.out.js`);
      assume(output[1]).equals('');
      assume(output[0].trim()).matches(/\/test\/throws.js:6:11\)$/);
    });
    
    it('should override the options it needs internally', async () => {
      await subject.__compile('test/throws.js', 'test-out/throws.out.js', {
        sourceMaps: false,
        sourceFileName: 'ooogie-boogie',
        sourceMapTarget: 'Australia',
        sourceRoot: 'Norway',
      });
      let output = await exec(`${process.argv[0]} test-out/throws.out.js`);
      assume(output[1]).equals('');
      assume(output[0].trim()).matches(/\/test\/throws.js:6:11\)$/);
    });
  });
});
