// Libraries.
const colors = require('ansi-colors');
const del = require('del');
const log = require('fancy-log');

/**
 * Clean a path.
 *
 * @param {string} path - The path to clean.
 * @param {string} [label] - The label to show on the console after `clean -> `
 * @returns {Promise}
 */
function clean(path, label) {
  const subTaskLabel = colors.cyan(`clean -> ${label == null ? path : label}`);

  return new Promise(async resolve => {
    log(`Starting '${subTaskLabel}'...`);
    await del(path);
    log(`Finished '${subTaskLabel}'`);
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
  cleanDist: config => clean(`./${config.dist.path}`, 'dist'),
  cleanTemp: config => clean(`./${config.temp.path}`, 'temp'),
  cleanDocs: config => clean(`./${config.docs.path}`, 'docs'),

  // Transform functions.
  transforms: {
    getFileContents: transformGetFileContents
  }
};
