// Load util.
const tasksUtil = require('./util');

// Libraries.
const fs = require('fs');
const wct = require('web-component-tester');

/**
 * Run the web componet tester tests.
 *
 * @param {GulpClient.Gulp} gulp - Gulp library
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function wctTests(gulp, config, labelPrefix) {
  const subTaskLabel = 'wct';

  return new Promise(async (resolve, reject) => {
    try {
      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      if (fs.existsSync(`./${config.dist.path}`)) {
        await wct.test(config.tests.wctConfig);

        resolve();
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      } else {
        throw new Error(
          `No ${config.dist.path}/ path exists - cannot run wct tests. ` +
            `Please build the component before testing.`
        );
      }
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

// Export the test function.
module.exports = (gulp, config) => {
  return new Promise(async (resolve, reject) => {
    try {
      await wctTests(gulp, config);

      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
