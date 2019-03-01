// Makes the script crash on unhandled rejections instead of silently
// ignoring them. In the future, promise rejections that are not handled will
// terminate the Node.js process with a non-zero exit code.
process.on('unhandledRejection', (error) => {
  // tslint:disable-next-line:no-throw
  throw error;
});

import { build } from './functions/build';

// Start
(async (): Promise<void> => {
  await build();
})()
  .catch((error) => {
    // tslint:disable-next-line:no-throw
    throw error;
  });
