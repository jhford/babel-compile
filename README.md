# babel-compile
[![Build Status](https://travis-ci.org/jhford/babel-compile.svg?branch=master)](https://travis-ci.org/jhford/babel-compile)
The `babel-cli` application amazing.  We can only compile by directory one at a
time, we have to wrap our babel invocations in an `rm -rf out/` to make sure
that only files we expect to exist do.  Instead of trying to fix the upstream
cli client, we've decided to use the really simple babel-core API to do our
compiling ourselves.

The result is a babel cli client which does things the way we want:

* Automatically generate source maps with correct file references
* Cleans output directory
* Allows us to load configuration from an NPM module instead of copying around
  a .babelrc

Version 3 is a near complete rewrite.  `babel-compile` no longer uses sync
versions of the apis.  It also allows you to additionally compile files instead
of just directories.

## Getting started
First, you're going to want to install this package
```
npm install babel-compile --save-dev
npm install babel-preset-es2015 --save-dev
```
Next, you're going to want to add it to your `package.json` file's scripts
section.

Assuming that you store your code in `src/` and your tests in `test/` and you
want them to respectively end up in `lib/` and `.test/`, you could add the
following to your package.json:

```json
...
"scripts": {
  "compile": "babel-compile -p es2015 src:lib test:.test",
  "pretest": "npm run compile",
  "prepublish": "npm run compile"
}
...

```

Whenever you run `npm test` or `npm publish`, you will also have your code
compiled automatically.  If you want to test your code, you can run `npm run
compile` to get a compiled copy.

## Using babel-compile with your project's tests
Mocha has a built in hook for comping code with babel as its imported.  We
don't use this hook anymore as it could work around bugs correctly in tests
that aren't worked around in a deployed set of code.  An example of problem
code is the `Array.prototype` shim methods like `.include`.

When importing code from a babel-compiled library in your tests, ensure that
you
```
require('../lib/file');
```
to include the compiled copy for the program.

As well, your package.json file's test script should use, as an example,
`.test/*_test.js` instead of `test/*_test.js`

## Source Maps (why do I have awful stack traces)
If you're finding your stack traces to be less than helpful, your interpreter
is likely unable to nateively parse source maps.  If you'd like have support
for stack traces with accurate line numbers, you can insteall
  `source-map-support`:
```
npm install source-map-support
```
Now in all your application's scripts include this as the first executable
line:
```
require('source-map-support').install();
```
You should only run this .install() method once, and only in the entry point to
your application.  Libraries should let applications set up this support.


## Hacking
Like most node modules, `npm test` is what you're looking for.  There are two
groups of tests.  The first is some command line tests to make sure that the
CLI works.  Then mocha tests are invoked.  One important note if you're
planning on working on babel-compile is that babel-compile is written in JS
code that needs babel to compile.  In order to generate babel-compile in a way
that the babel-compile we ship has good source maps, we bootstrap with
babel-cli.

The build process for babel-compile uses babel-cli to build a throw-away copy
of babel-compile.  Once we have that copy built, we use it to generate the real
version that'll be uploaded with `npm publish`

