# babel-compile
While putting static babel-compiling in place, we've discovered that the babel
cli client is not perfectly suited to our usage.  We can only compile by directory
one at a time, we have to wrap our babel invocations in an `rm -rf out/` to make
sure that only files we expect to exist do.  Instead of trying to fix the upstream
cli client, we've decided to use the really simple babel-core API to do our compiling
ourselves.

The result is a babel cli client which does things the way we want:

* Automatically generate source maps with correct file references
* Cleans output directory
* Allows us to load configuration from an NPM module instead of copying around a .babelrc

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

Whenever you run `npm test` or `npm publish`, you will also have your code compiled
automatically.  If you want to test your code, you can run `npm run compile` to get
a compiled copy.

## Tests
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
If you're using Node 0.12, you're likely noticing that your stack traces are terrible.
This is because the Node 0.12 environment doesn't support source maps natively.
If you'd like to have useful stacktraces, you can do this:

```
npm install source-map-support
```
and then, in your non-library js-code, add
```
require('source-map-support').install();
```
to get nice stacks with real line numbers. More details here:
https://github.com/evanw/node-source-map-support
