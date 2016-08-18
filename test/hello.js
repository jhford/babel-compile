'use strict';

let hi = async () => {
  await Promise.resolve();
  return 'hi';
}

hi().then(console.log, console.dir);
