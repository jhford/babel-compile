#!/bin/bash
#  Bootstrap compile babel-compile.
#
#  We want to compile babel-compile once to get a working compiler.  Because we
#  don't trust babel-cli to generate sourcemaps correctly, we then use our
#  first copy of babel-compile on the babel-compile sources to generate the
#  final good version of babel-compile

set -e

export PATH="$PWD/node_modules/.bin:$PATH"

bootstrapDir="$(mktemp -d)"

# Use babel-cli to get an executable copy of babel-compile
for jsFile in $(find src -name "*.js") ; do
  outDir="$bootstrapDir/$(dirname $jsFile)"
  outFile="$bootstrapDir/$jsFile"
  mkdir -p $outDir
  echo bootstrap compiling $jsFile '=>' $outFile
  babel --presets taskcluster $jsFile -o $outFile
done

# We need a copy of our dependencies for running
if [ -f $bootstrapDir/node_modules ] ; then
  rm -f $bootstrapDir/node_modules
fi
ln -s $PWD/node_modules $bootstrapDir/node_modules

# We need the package.json file internally
if [ -f $bootstrapDir/package.json ] ; then
  rm -f $bootstrapDir/package.json
fi
ln -s $PWD/package.json $bootstrapDir/package.json

# Compile babel-compile for real
node $bootstrapDir/src/cli.js -p taskcluster src:lib
rm -rf $bootstrapDir
