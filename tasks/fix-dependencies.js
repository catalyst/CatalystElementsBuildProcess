// Load util.
const tasksUtil = require('./util');

// Libraries.
const fs = require('graceful-fs');

/**
 * Fix prismjs.
 *
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixPrismjs(labelPrefix) {
  const subTaskLabel = `prismjs`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync('./node_modules/prismjs');
      const bad = fs.existsSync('./node_modules/prism');

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        fs.symlinkSync('./prismjs', './node_modules/prism', 'dir');
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      } else {
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
      }

      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Fix test-fixture.
 *
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixTestFixture(labelPrefix) {
  const subTaskLabel = `test-fixture`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync('./node_modules/@polymer/test-fixture');
      const bad = fs.existsSync('./node_modules/test-fixture');

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        fs.symlinkSync(
          './@polymer/test-fixture',
          './node_modules/test-fixture',
          'dir'
        );
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      } else {
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
      }
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Fix async.
 *
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixAsync(labelPrefix) {
  const subTaskLabel = `async`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync('./node_modules/async/dist/async.js');
      const bad = fs.existsSync('./node_modules/async/lib/async.js');

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        if (!fs.existsSync('./node_modules/async/lib/')) {
          fs.mkdirSync('./node_modules/async/lib/');
        }
        fs.symlinkSync(
          '../dist/async.js',
          './node_modules/async/lib/async.js',
          'file'
        );
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      } else {
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
      }
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

/**
 * Fix sinon.
 *
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixSinon(labelPrefix) {
  const subTaskLabel = `sinon`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync('./node_modules/sinon/pkg/sinon.js');
      const bad = fs.existsSync('./node_modules/sinonjs/sinon.js');

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        if (!fs.existsSync('./node_modules/sinonjs')) {
          fs.mkdirSync('./node_modules/sinonjs');
        }
        fs.symlinkSync(
          '../sinon/pkg/sinon.js',
          './node_modules/sinonjs/sinon.js',
          'file'
        );
        tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
      } else {
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
      }
      resolve();
    } catch (error) {
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
      reject(error);
    }
  });
}

// Export the fix dependencies function.
module.exports = () => {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all([
        fixPrismjs(),
        fixTestFixture(),
        fixAsync(),
        fixSinon()
      ]);
      resolve();
    } catch (error) {
      console.error(error);
      reject(error);
    }
  });
};
