// Load util.
const tasksUtil = require('./util');

// Libraries.
const fs = require('graceful-fs');
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
    tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

    if (fs.existsSync(`./${config.dist.path}`)) {
      await wct.test(config.tests.wctConfig);
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      resolve();
    } else {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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
