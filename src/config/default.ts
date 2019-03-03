import { Config as WCTConfig } from 'web-component-tester';

import { DeepPartial } from '../types';

import { Config } from './interface';

const wctConfig = {
  suites: ['test/index.html'],
  plugins: {
    local: {
      browserOptions: {
        firefox: ['-headless']
      },
      browsers: [
        'firefox'
      ],
      disabled: false
    }
  },
  expanded: true,
  npm: true,
  compile: 'never',
  enforceJsonConf: true,
  extraScripts: [
    '/test/test-component.js'
  ]
};

export const defaultStaticConfig: DeepPartial<Config> = {
  build: {
    module: {
      create: true,
      extension: '.mjs'
    },
    script: {
      create: true,
      extension: '.min.js'
    },
    tools: {
      development: {},
      production: {},
      test: {}
    }
  },
  demos: {
    path: 'demo'
  },
  dist: {
    path: 'dist'
  },
  docs: {
    analysisFilename: 'analysis.json',
    nodeModulesPath: 'vendor',
    path: 'docs',
    templateFiles: {
      entrypoint: 'templates/docs/main.ts',
      indexHtml: 'templates/docs/index.html.ejs',
      style: 'templates/docs/style.scss',
      es5AdapterLoader: 'templates/docs/es5-adapter-loader.js.ejs',
      tsconfig: 'templates/tsconfig.json'
    }
  },
  publish: {
    archiveFormats: {
      tar: {
        extension: '.tar.gz',
        ignore: false,
        options: {
          gzip: true,
          gzipOptions: {
            level: 6
          }
        }
      },
      zip: {
        extension: '.zip',
        ignore: false,
        options: {
          zlib: {
            level: 6
          }
        }
      }
    },
    checkFiles: {
      package: true,
      script: true,
      module: true,
      license: true,
      readme: true
    },
    dryrun: false,
    force: false,
    hostedOnGitHub: true,
    masterBranch: 'master',
    prereleaseBranchRegex: /^(?:[1-9][0-9]*)\.0-preview|master$/g,
    runFileChecks: true,
    runGitChecks: true
  },
  src: {
    path: 'src',
    entrypoint: '**/*{[!.d].ts,.js}',
    configFiles: {
      tsconfig: '../tsconfig.json',
      tslint: '../tslint.json',
      styleLint: '../.stylelintrc.json'
    }
  },
  temp: {
    path: '.tmp'
  },
  tests: {
    path: 'test',
    testFiles: 'index.ts',
    configFiles: {
      tsconfig: 'tsconfig.json',
      tslint: 'tslint.json',
      styleLint: '../.stylelintrc.json'
    },
    wctConfig:
      process.env.CI === undefined || process.env.CI === 'false'
      // When not in CI, add chrome to the list of browser to test against.
      ? {
          ...wctConfig,
          plugins: {
            ...wctConfig.plugins,
            local: {
              ...wctConfig.plugins.local,
              browserOptions: {
                ...wctConfig.plugins.local.browserOptions,
                chrome: ['headless']
              },
              browsers: [
                ...wctConfig.plugins.local.browsers,
                'chrome'
              ],
              disabled: false
            }
          }
        } as WCTConfig
      : wctConfig as WCTConfig
  }
};
