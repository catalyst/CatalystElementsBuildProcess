// Libraries.
const fs = require('fs');
const deepClone = require('deepclone');
const deepMerge = require('deepmerge');

// Config
const defaultConfig = require('./default-config');
const userConfig = deepClone(defaultConfig);

/**
 * Set the config for the build process.
 *
 * @param {string} packagePath - Path to user's package.json
 * @param {Object} config - The config object.
 * @returns {Object}
 */
function setConfig(packagePath, config) {
  try {
    // Merge the config into the default config.
    const newConfig = deepMerge(defaultConfig, config);

    // Copy over the new config settings into the user config object.
    for (const [key, value] of Object.entries(newConfig)) {
      userConfig[key] = value;
    }

    // Delete any the extra keys.
    for (const key of Object.keys(userConfig)) {
      if (newConfig[key] == null) {
        delete newConfig[key];
      }
    }

    // Read and save the package.json file.
    fs.accessSync(packagePath, fs.constants.R_OK);
    userConfig.packageInfo = JSON.parse(fs.readFileSync(packagePath));

    // Find and set the package scope.
    userConfig.componenet.scope = userConfig.packageInfo.name.substring(
      0,
      userConfig.packageInfo.name.lastIndexOf('/')
    );
    if (userConfig.componenet.scope === '') {
      userConfig.componenet.scope = null;
    }

    // Set the path to the component within node modules.
    userConfig.componenet.nodeModulesPath = `${newConfig.nodeModulesPath}${
      userConfig.componenet.scope === null
        ? ''
        : `/${userConfig.componenet.scope}`
    }`;

    // Return the config.
    return userConfig;
  } catch (error) {
    throw error;
  }
}

// Load the tasks.
const analyze = require('./tasks/analyze');
const build = require('./tasks/build');
const lint = require('./tasks/lint');
const test = require('./tasks/test');
const util = require('./tasks/util');

// Export the task functions.
module.exports = {
  setConfig: setConfig,
  tasks: {
    analyze: gulp => async () => {
      await analyze(gulp, userConfig);
    },
    build: gulp => async () => {
      await build(gulp, userConfig);
    },
    clean: () => async () => {
      await util.cleanTemp(userConfig);
    },
    lint: gulp => async () => {
      await lint(gulp, userConfig);
    },
    test: gulp => async () => {
      await test(gulp, userConfig);
    }
  }
};
