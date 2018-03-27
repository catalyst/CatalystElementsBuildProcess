// Libraries.
const colors = require('ansi-colors');
const fs = require('graceful-fs');
const log = require('fancy-log');
const wct = require('web-component-tester');

/**
 * Run the web componet tester tests.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @returns {Promise}
 */
function wctTests(gulp, config) {
  const subTaskLabel = `'${colors.cyan('test -> wct')}'`;

  return new Promise(async (resolve, reject) => {
    log(`Starting ${subTaskLabel}...`);

    if (fs.existsSync(`./${config.dist.path}`)) {
      await wct.test(config.tests.wctConfig);
      log(`Finished ${subTaskLabel}`);
      resolve();
    } else {
      log(`${colors.cyan('Failed')} ${subTaskLabel}`);
      reject(
        new Error(
          `No ${config.dist.path}/ path exists - cannot run wct tests. ` +
            `Please build the component before testing.`
        )
      );
    }
  });
}

// Export the test function.
module.exports = (gulp, config) => {
  return new Promise(async resolve => {
    await wctTests(gulp, config);
    resolve();
  });
};
