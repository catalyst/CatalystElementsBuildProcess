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

    // Return the config.
    return userConfig;
  } catch (error) {
    throw error;
  }
}

module.exports = {
  setConfig: setConfig,
  tasks: {
    build: gulp => async () => {
      await require('./tasks/build')(gulp, userConfig);
    },
    clean: () => async () => {
      await require('./tasks/util').cleanTemp(userConfig);
    },
    lint: gulp => async () => {
      await require('./tasks/lint')(gulp, userConfig);
    },
    test: gulp => async () => {
      await require('./tasks/test')(gulp, userConfig);
    }
  }
};
