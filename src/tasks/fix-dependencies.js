// Load util.
const tasksUtil = require('./util');

// Libraries.
const fs = require('fs');
const util = require('util');

// Promisified functions.
const fsMkdir = util.promisify(fs.mkdir);
const fsReadFile = util.promisify(fs.readFile);
const fsSymlink = util.promisify(fs.symlink);
const fsWriteFile = util.promisify(fs.writeFile);

/**
 * Fix prismjs.
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixPrismjs(config, labelPrefix) {
  const subTaskLabel = `prismjs`;

  return new Promise(async (resolve, reject) => {
    try {
      const good = fs.existsSync(`./${config.nodeModulesPath}/prismjs`);
      const bad = fs.existsSync(`./${config.nodeModulesPath}/prism`);

      if (!good || bad) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await fsSymlink('./prismjs', `./${config.nodeModulesPath}/prism`, 'dir');

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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

  return new Promise(async (resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/@polymer/test-fixture`
      );
      const bad = fs.existsSync(`./${config.nodeModulesPath}/test-fixture`);

      if (!good || bad) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await fsSymlink(
        './@polymer/test-fixture',
        `./${config.nodeModulesPath}/test-fixture`,
        'dir'
      );

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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

  return new Promise(async (resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/async/dist/async.js`
      );
      const bad = fs.existsSync(
        `./${config.nodeModulesPath}/async/lib/async.js`
      );

      if (!good || bad) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      if (!fs.existsSync(`./${config.nodeModulesPath}/async/lib/`)) {
        await fsMkdir(`./${config.nodeModulesPath}/async/lib/`, 0o777);
      }

      await fsSymlink(
        '../dist/async.js',
        `./${config.nodeModulesPath}/async/lib/async.js`,
        'file'
      );

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
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

  return new Promise(async (resolve, reject) => {
    try {
      const good = fs.existsSync(
        `./${config.nodeModulesPath}/sinon/pkg/sinon.js`
      );
      const bad = fs.existsSync(`./${config.nodeModulesPath}/sinonjs/sinon.js`);

      if (!good || bad) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      if (!fs.existsSync(`./${config.nodeModulesPath}/sinonjs`)) {
        await fsMkdir(`./${config.nodeModulesPath}/sinonjs`, 0o777);
      }

      await fsSymlink(
        '../sinon/pkg/sinon.js',
        `./${config.nodeModulesPath}/sinonjs/sinon.js`,
        'file'
      );

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

/**
 * Fix iron-scroll-manager.js
 *
 * @param {Object} config - Config settings
 * @param {string} [labelPrefix] - A prefix to print before the label
 * @returns {Promise}
 */
function fixIronScrollManager(config, labelPrefix) {
  const subTaskLabel = `iron-scroll-manager.js`;

  return new Promise(async (resolve, reject) => {
    try {
      const file = `./${
        config.nodeModulesPath
      }/@polymer/iron-overlay-behavior/iron-scroll-manager.js`;

      const content = await fsReadFile(file, 'utf8');

      const updatedContent = content
        .replace(
          /export const _lockedElementCache = null;/g,
          'export let _lockedElementCache = null;'
        )
        .replace(
          /export const _unlockedElementCache = null;/g,
          'export let _unlockedElementCache = null;'
        );

      if (updatedContent === content) {
        resolve();
        tasksUtil.tasks.log.info(
          `skipping "${subTaskLabel}" - seems ok.`,
          labelPrefix
        );
        return;
      }

      tasksUtil.tasks.log.starting(subTaskLabel, labelPrefix);

      await fsWriteFile(file, updatedContent, 'utf8');

      resolve();
      tasksUtil.tasks.log.successful(subTaskLabel, labelPrefix);
    } catch (error) {
      reject(error);
      tasksUtil.tasks.log.failed(subTaskLabel, labelPrefix);
    }
  });
}

// Export the fix dependencies function.
module.exports = config => {
  return new Promise(async (resolve, reject) => {
    try {
      await tasksUtil.waitForAllPromises([
        fixPrismjs(config),
        fixTestFixture(config),
        fixAsync(config),
        fixSinon(config),
        fixIronScrollManager(config)
      ]);

      resolve();
    } catch (error) {
      reject(error);
    }
  });
};
