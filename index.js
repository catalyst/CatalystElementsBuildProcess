// Libraries.
const fs = require('fs');
const deepClone = require('deepclone');
const deepMerge = require('deepmerge');

// Config
const defaultConfig = require('./default-config');
const userConfig = deepClone(defaultConfig);

// Load the tasks.
const analyze = require('./tasks/analyze');
const build = require('./tasks/build');
const docs = require('./tasks/docs');
const fixDependencies = require('./tasks/fix-dependencies');
const lint = require('./tasks/lint');
const publish = require('./tasks/publish');
const test = require('./tasks/test');
const util = require('./tasks/util');

/**
 * Set the config for the build process.
 *
 * @param {string} packagePath - Path to user's package.json
 * @param {Object} config - The config object.
 * @throws {Error}
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

    // Delete anything in user config that shouldn't be there anymore.
    for (const key of Object.keys(userConfig)) {
      if (newConfig[key] == null) {
        delete userConfig[key];
      }
    }

    // Read and save the package.json file.
    fs.accessSync(packagePath, fs.constants.R_OK);
    userConfig.package = JSON.parse(fs.readFileSync(packagePath));

    // If the scope is not set.
    if (userConfig.componenet.scope == null) {
      // Find and set the package scope.
      userConfig.componenet.scope = userConfig.package.name.substring(
        0,
        userConfig.package.name.lastIndexOf('/')
      );

      // No scope?
      if (userConfig.componenet.scope === '') {
        userConfig.componenet.scope = null;
      }
    }

    if (userConfig.componenet.nodeModulesPath == null) {
      // Set the path to the component within the node modules folder.
      userConfig.componenet.nodeModulesPath = `${userConfig.nodeModulesPath}${
        userConfig.componenet.scope == null
          ? ''
          : `/${userConfig.componenet.scope}`
      }`;
    }
  } catch (error) {
    throw error;
  }

  // Check the new config is all good.
  if (!userConfig.build.script.build && !userConfig.build.module.build) {
    throw new Error(
      'Invalid config - Both building of the module and the script cannot be turned off.'
    );
  }

  if (userConfig.build.script.extension === userConfig.build.module.extension) {
    throw new Error(
      'Invalid config - The module and the script cannot both have the same file extension.'
    );
  }

  // Return the config.
  return userConfig;
}

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
    'build-docs': gulp => async () => {
      await docs(gulp, userConfig);
    },
    clean: () => async () => {
      await util.cleanTemp(userConfig);
    },
    'fix-dependencies': () => async () => {
      await fixDependencies(userConfig);
    },
    lint: gulp => async () => {
      await lint(gulp, userConfig);
    },
    test: gulp => async () => {
      await test(gulp, userConfig);
    },
    publish: gulp => async () => {
      await publish(gulp, userConfig);
    }
  }
};
