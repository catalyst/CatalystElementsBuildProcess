// Libraries.
import deepClone from 'deepclone';
import deepMerge from 'deepmerge';
import { accessSync, constants, readFileSync } from 'fs';
import GulpClient from 'gulp';

// Config
import defaultConfig from './default-config';

// Load the tasks.
import analyze from './tasks/analyze';
import build from './tasks/build';
import docs from './tasks/docs';
import fixDependencies from './tasks/fix-dependencies';
import lint from './tasks/lint';
import publish from './tasks/publish';
import test from './tasks/test';
import util from './tasks/util';

const userConfig = deepClone(defaultConfig);

/**
 * Set the config for the build process.
 *
 * @param {string} packagePath - Path to user's package.json
 * @param {Object} config - The config object.
 * @throws {Error}
 * @returns {Object}
 */
function setConfig(packagePath: string, config: object): object {
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
    accessSync(packagePath, constants.R_OK);
    userConfig.package = JSON.parse(
      readFileSync(packagePath, { encoding: 'utf8' })
    );

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

const tasks = {
  analyze: (gulp: GulpClient.Gulp) => async () => {
    await analyze(gulp, userConfig);
  },
  build: (gulp: GulpClient.Gulp) => async () => {
    await build(gulp, userConfig);
  },
  'build-docs': (gulp: GulpClient.Gulp) => async () => {
    await docs(gulp, userConfig);
  },
  clean: () => async () => {
    await util.cleanTemp(userConfig);
  },
  'fix-dependencies': () => async () => {
    await fixDependencies(userConfig);
  },
  lint: (gulp: GulpClient.Gulp) => async () => {
    await lint(gulp, userConfig);
  },
  publish: (gulp: GulpClient.Gulp) => async () => {
    await publish(gulp, userConfig);
  },
  test: (gulp: GulpClient.Gulp) => async () => {
    await test(gulp, userConfig);
  }
};

export { setConfig, tasks };
