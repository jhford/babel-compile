#!/bin/bash

echo Compiling for tests
compileLog=$(mktemp)
./compile.sh &> $compileLog
if [ $? -ne 0 ] ; then
  cat $compileLog
  echo ==================================================================
  echo "Error compiling!"
  exit 1
fi
echo Finished compiling

rc=0

evaluate () {
  actualRC=$1 ; shift
  wantedRC=$1 ; shift
  msg=$1 ; shift

  echo ==================================================================
  $(which echo) -n "TEST OUTCOME: "
  if [ $actualRC -eq $wantedRC ] ; then
    echo PASS $msg
    rm -rf $@
  else
    rc=1
    echo FAIL $msg
  fi
  echo ==================================================================
}

runtest () {
  node ./lib/cli.js -p taskcluster $@
  return $?
}

# Let's test that a known good example works with only a directory.
runtest sample-in:sample-out
evaluate $? 0 "normal mix of js and non-js files" sample-out

# Let's test that a known good example works with only a js single file.
runtest test/hello.js:test/bye.js
evaluate $? 0 "compiling a single file" test/bye.js

# Let's test that a known good example works with only a non-js single file.
runtest test/notajsfile:test/notajsfile.out
evaluate $? 0 "compiling a single file" test/notajsfile.out

# Let's test that a known good example works with mix of dir, js and non-js
runtest sample-in:sample-out test/notajsfile:test/notajsfile.out test/hello.js:test/bye.js
evaluate $? 0 "normal mix of js and non-js files" sample-out test/notajsfile.out test/bye.js

runtest test/source-map-overshadow:test/out
evaluate $? 1 "source map shadow test" test/out

export PATH="$PWD/node_modules/.bin:$PATH"
mocha --opts mocha-tests/mocha.opts mocha-test/*_test.js
evaluate $? 0 "mocha tests"


if [ $rc -eq 0 ] ; then
  echo OVERALL SUCCESS
else
  echo '!!! OVERALL FAILURE !!!'
fi

exit $rc
