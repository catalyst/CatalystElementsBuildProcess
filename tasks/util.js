// Libraries.
const colors = require('ansi-colors');
const del = require('del');
const log = require('fancy-log');

// Helper functions for tasks.
const tasksHelpers = {
  log: {
    starting: (depth, label) => {
      log(
        `Starting ${colors.blue(' ').repeat(2 * depth)}${colors.blue(
          '→'
        )} ${colors.cyan(label)}...`
      );
    },
    successful: (depth, label) => {
      log(
        `Finished ${colors.blue(' ').repeat(2 * depth)}${colors.blue(
          '→'
        )} ${colors.cyan(label)} ${colors.green('✓')}`
      );
    },
    failed: (depth, label) => {
      log(
        `Failed   ${colors.blue(' ').repeat(2 * depth)}${colors.blue(
          '→'
        )} ${colors.cyan(label)} ${colors.red('✗')}`
      );
    },
    info: (depth, label) => {
      log(
        `         ${colors.blue(' ').repeat(2 * depth)}${colors.blue(
          '→'
        )} ${colors.white(label)}`
      );
    }
  }
};

/**
 * Clean a path.
 *
 * @param {string} path - The path to clean.
 * @param {string} [label] - The label to show on the console after `clean -> `
 * @param {number} [labelDepth=1] - The depth the label is at
 * @returns {Promise}
 */
function clean(path, label, labelDepth = 1) {
  const subTaskLabel = `clean: ${label == null ? path : label}`;

  return new Promise(async resolve => {
    tasksHelpers.log.starting(labelDepth, subTaskLabel);
    await del(path);
    tasksHelpers.log.successful(labelDepth, subTaskLabel);
    resolve();
  });
}

/**
 * Transform function that returns the contents of the given file.
 *
 * @param {string} filePath
 *   The file path.
 * @param {File} file
 *   The file.
 * @returns {string}
 */
function transformGetFileContents(filePath, file) {
  return file.contents.toString('utf8');
}

module.exports = {
  // Clean tasks.
  cleanDist: (config, labelDepth) =>
    clean(`./${config.dist.path}`, 'dist', labelDepth),
  cleanTemp: (config, labelDepth) =>
    clean(`./${config.temp.path}`, 'temp', labelDepth),
  cleanDocs: (config, labelDepth) =>
    clean(`./${config.docs.path}`, 'docs', labelDepth),

  // Transform functions.
  transforms: {
    getFileContents: transformGetFileContents
  },

  tasks: tasksHelpers
};
