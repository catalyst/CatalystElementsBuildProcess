// Load util.
const tasksUtil = require('./util');

// Libraries.
const fs = require('graceful-fs');

/**
 * Fix prismjs.
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixPrismjs(config, labelPrefix) {
  const subTaskLabel = `prismjs`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync(`./${config.nodeModulesPath}/prismjs`);
      const bad = fs.existsSync(`./${config.nodeModulesPath}/prism`);

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        fs.symlinkSync('./prismjs', `./${config.nodeModulesPath}/prism`, 'dir');
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
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixTestFixture(config, labelPrefix) {
  const subTaskLabel = `test-fixture`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/@polymer/test-fixture`
      );
      const bad = fs.existsSync(`./${config.nodeModulesPath}/test-fixture`);

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        fs.symlinkSync(
          './@polymer/test-fixture',
          `./${config.nodeModulesPath}/test-fixture`,
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
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixAsync(config, labelPrefix) {
  const subTaskLabel = `async`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/async/dist/async.js`
      );
      const bad = fs.existsSync(
        `./${config.nodeModulesPath}/async/lib/async.js`
      );

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        if (!fs.existsSync(`./${config.nodeModulesPath}/async/lib/`)) {
          fs.mkdirSync(`./${config.nodeModulesPath}/async/lib/`);
        }
        fs.symlinkSync(
          '../dist/async.js',
          `./${config.nodeModulesPath}/async/lib/async.js`,
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
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixSinon(config, labelPrefix) {
  const subTaskLabel = `sinon`;

  return new Promise((resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/sinon/pkg/sinon.js`
      );
      const bad = fs.existsSync(`./${config.nodeModulesPath}/sinonjs/sinon.js`);

      if (good && !bad) {
        tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);
        if (!fs.existsSync(`./${config.nodeModulesPath}/sinonjs`)) {
          fs.mkdirSync(`./${config.nodeModulesPath}/sinonjs`);
        }
        fs.symlinkSync(
          '../sinon/pkg/sinon.js',
          `./${config.nodeModulesPath}/sinonjs/sinon.js`,
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
module.exports = config => {
  return new Promise(async (resolve, reject) => {
    try {
      await Promise.all([
        fixPrismjs(config),
        fixTestFixture(config),
        fixAsync(config),
        fixSinon(config)
      ]);
      resolve();
    } catch (error) {
      console.error(error);
      reject(error);
    }
  });
};
