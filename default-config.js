// Libraries.
const colorGuard = require('colorguard');
const cssMQPacker = require('css-mqpacker');
const cssnano = require('cssnano');
const postcssAutoReset = require('postcss-autoreset');
const postcssCqProlyfill = require('cq-prolyfill/postcss-plugin');
const postcssFontMagician = require('postcss-font-magician');
const postcssInitial = require('postcss-initial');
const postcssImageSet = require('postcss-image-set-polyfill');
const postcssImport = require('postcss-import');
const postcssCssNext = require('postcss-cssnext');
const postcssPresetEnv = require('postcss-preset-env');
const postcssReporter = require('postcss-reporter');

module.exports = {
  /** Where the node module files are relative to the component's projectroot. */
  nodeModulesPath: 'node_modules',

  /** Component settings. */
  componenet: {
    /** The name of the component. */
    name: null,

    /** @private The npm scope of the component */
    scope: null,

    /** @private The path to the component when it is in node modules. */
    nodeModulesPath: null
  },

  /** Build settings. */
  build: {
    /** Module settings */
    module: {
      /** Build the module? */
      build: true,

      /** Module extension */
      extension: '.mjs'
    },

    /** Script settings */
    script: {
      /** Build the script? */
      build: true,

      /** Script extension */
      extension: '.min.js',

      /** Bundle in all the imports? */
      bundleImports: false,

      /** Export all the static imports? */
      exportAllStaticImports: false
    },

    /** HTML Minifier settings */
    htmlMinifier: {
      collapseBooleanAttributes: true,
      collapseWhitespace: true,
      conservativeCollapse: false,
      ignoreCustomFragments: [/<demo-snippet>[\s\S]*<\/demo-snippet>/],

      // HtmlMinifier does not have support for async functions.
      // minifyCSS: async css => {
      //   const { css: processedCss } = await postcss(postcssPlugins).process(
      //     css
      //   );
      //   return processedCss;
      // },
      minifyCSS: true,
      minifyJS: true,
      quoteCharacter: '"',
      removeAttributeQuotes: false,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      trimCustomFragments: true,
      useShortDoctype: true
    },

    /** PostCSS settings */
    postcss: {
      plugins: [
        postcssImport(),
        postcssAutoReset(),
        postcssInitial(),
        postcssPresetEnv(),
        postcssCqProlyfill(),
        postcssImageSet(),
        postcssFontMagician(),
        postcssCssNext({
          browsers: ['last 5 versions', '>= 1%', 'ie >= 11'],
          features: {
            customProperties: false
          }
        }),
        cssMQPacker(),
        colorGuard(),
        cssnano({
          autoprefixer: false,
          discardComments: {
            removeAll: true
          }
        }),
        postcssReporter()
      ],
      options: {}
    }
  },

  /** Publish settings. */
  publish: {
    /** Check that git has everything in sync and ready for publishing? */
    runGitChecks: true,

    /** Check that the files are ready publishing? */
    runFileChecks: true,

    /** Run checks on the following files: (ignored if publish.runFileChecks is false) */
    checkFiles: {
      package: true,
      script: true,
      module: true,
      license: true,
      readme: true
    },

    /** The name of the git master branch. */
    masterBranch: 'master',

    /** Regex for the prerelease branches. */
    prereleaseBranchRegex: /^(?:[1-9][0-9]*)\.0-preview|master$/g,

    /** Is the component project hosted on GitHub? */
    hostedOnGitHub: true,

    /** Archives formats to upload to GitHub Release. */
    archiveFormats: {
      /** Tar archive. */
      tar: {
        /** Don't use this format. */
        ignore: false,

        /** File extension. */
        extension: '.tar.gz',

        /** Archive options. */
        options: {
          gzip: true,
          gzipOptions: {
            level: 6
          }
        }
      },

      /** Zip archive. */
      zip: {
        /** Don't use this format. */
        ignore: false,

        /** File extension. */
        extension: '.zip',

        /** Archive options. */
        options: {
          zlib: {
            level: 6
          }
        }
      }
    },

    /** Do a dry run? */
    dryrun: false,

    /** For the release - ignore non critical errors along the way. */
    force: false
  },

  /** Source settings. */
  src: {
    /** The path to the source folder relative to the component's projectroot. */
    path: 'src',

    /** The path to the entrypoint file relative to `src.path` */
    entrypoint: null,

    /** The templates to be injected. */
    template: null
  },

  /** Distribution settings. */
  dist: {
    /** The path to the distribution folder relative to the component's projectroot. */
    path: 'dist'
  },

  /** Demo settings. */
  demos: {
    /** The path to the demos folder relative to the component's projectroot. */
    path: 'demo',

    /** The file that imports the demo dependencies relative to `demos.path`. */
    importsFilename: 'imports.mjs',

    /** The file that imports `demos.importsFilename` relative to `demos.path`. */
    importsImporterFilename: 'imports-importer.mjs'
  },

  /** Documentation settings. */
  docs: {
    /** The path to the documentation folder relative to the component's projectroot. */
    path: 'docs',

    /** The index page of the documentation relative to the component's projectroot. */
    indexPage: 'index.html',

    /** The folder name for the node modules inside docs. */
    nodeModulesPath: 'scripts',

    /** The file that imports the docs dependencies relative to the component's projectroot. */
    importsFilename: 'docs-imports.mjs',

    /** The file that imports `docs.importsFilename` relative to the component's projectroot. */
    importsImporterFilename: 'docs-imports-importer.mjs',

    /** The file that contains the analysis data relative to the component's projectroot. */
    analysisFilename: 'analysis.json'
  },

  /** Test settings. */
  tests: {
    /** The path to the test folder relative to the component's projectroot. */
    path: 'test',

    /** The config for Web Component Tester. */
    wctConfig: {
      plugins: {
        local: {
          browsers: ['chrome', 'firefox'],
          browserOptions: {
            chrome: ['headless', 'disable-gpu'],
            firefox: ['-headless']
          }
        }
      },
      npm: true
    }
  },

  /** Temp settings. */
  temp: {
    /** The path to the temp folder relative to the component's projectroot. */
    path: '.tmp'
  },

  /** @private Contents of component project's package.json. */
  package: null
};
