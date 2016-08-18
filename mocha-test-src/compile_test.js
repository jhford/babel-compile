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
  let cleanup = [];
  let sandbox;

  before(() => {
    sandbox = sinon.sandbox.create();
  });

  beforeEach(() => {
    cleanup.forEach(x => rmrf(x));
    cleanup = [];
  });

  afterEach(() => {
    sandbox.restore();
    cleanup.forEach(x => rmrf(x));
    cleanup = [];
  });

  describe('.run', () => {
    it('should work with good data and no options', async () => {
      cleanup.push('sample-out');
      await subject.run(sampleMap); 
    });
    
    it('should work with good data and with empty options', async () => {
      cleanup.push('sample-out');
      await subject.run(sampleMap, {}); 
    });
    
    it('should work with good data and with used options', async () => {
      cleanup.push('sample-out');
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
    it('should hardlink when possible', async () => {
      rmrf('test/helloagain.js');
      await subject.__copy('test/hello.js', 'test/helloagain.js');
      assume(fs.lstatSync('test/hello.js').ino).equals(fs.lstatSync('test/helloagain.js').ino);
      // lol windows
      assume(fs.lstatSync('test/hello.js').ino).does.not.equals(0);
    });

    it('should symlink when hardlinking fails', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));

      rmrf('test/helloagain2.js');
      await subject.__copy('test/hello.js', 'test/helloagain2.js');
      cleanup.push('test/helloagain2.js');
      assert(fs.lstatSync('test/helloagain2.js').isSymbolicLink());
    });

    it('should copy when hardlinking and symlinking fail', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));

      rmrf('test/helloagain3.js');
      await subject.__copy('test/hello.js', 'test/helloagain3.js');
      cleanup.push('test/helloagain3.js');
      assert(!fs.lstatSync('test/helloagain3.js').isSymbolicLink());
      assert(fs.lstatSync('test/helloagain3.js').isFile());
      assume(fs.readFileSync('test/hello.js').toString()).equals(fs.readFileSync('test/helloagain3.js').toString());
    });

    it.skip('should throw error on read problem', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));
      try {
        await subject.__copy('test/hello.js', 'test/helloagain.js');
      } catch (err) { }
    });

    it.skip('should thorw error on write problem', async () => {
      let linkstub = sandbox.stub(mzfs, "link", (x, y) => Promise.reject(`refusing to hardlink ${x} -> ${y}`));
      let symstub = sandbox.stub(mzfs, "symlink", (x, y) => Promise.reject(`refusing to symlink ${x} -> ${y}`));
      try {
        await subject.__copy('test/hello.js', 'test/helloagain.js');
      } catch (err) { }
    });
  });

  describe('.compile', () => {
    it('should compile without options', async () => {
      await subject.__compile('test/hello.js', 'test/hellotest.js');
      let output = await exec(`${process.argv[0]} test/hellotest.js`);
      assume(output).deeply.equals([ 'hi\n', '' ]);
    });
    
    it('should generate valid source maps', async () => {
      await subject.__compile('test/throws.js', 'test/throws.out.js');
      let output = await exec(`${process.argv[0]} test/throws.out.js`);
      assume(output).deeply.equals([ '(throws.out.js:5:11)\n', '' ]);
    });
  });
});
