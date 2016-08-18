'use strict'; 
require('source-map-support').install();

let hi = async () => {
  await Promise.resolve();
  let a = new Error();
  let firstFrame = a.stack.split('\n')[1];
  let info = firstFrame.match(/\(.*\)$/)[0];
  return info;
}

hi().then(console.log, console.dir);
