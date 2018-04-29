// Libraries.
import { CoreOptions, TarOptions, TransformOptions, ZipOptions } from 'archiver';
import colorGuard from 'colorguard';
import postcssCqProlyfill from 'cq-prolyfill/postcss-plugin';
import cssMQPacker from 'css-mqpacker';
import cssnano from 'cssnano';
import { Options as htmlMinifierOptions } from 'html-minifier';
import postcssAutoReset from 'postcss-autoreset';
import postcssCssNext from 'postcss-cssnext';
import postcssFontMagician from 'postcss-font-magician';
import postcssImageSet from 'postcss-image-set-polyfill';
import postcssImport from 'postcss-import';
import postcssInitial from 'postcss-initial';
import postcssPresetEnv from 'postcss-preset-env';
import postcssReporter from 'postcss-reporter';

declare interface IConfig {
  /** Build settings. */
  build: {
    /** Module settings */
    module: {
      /** Build the module? */
      build: boolean;
      /** Module extension */
      extension: string;
    };
    /** Script settings */
    script: {
      /** Build the script? */
      build: boolean;
      /** Script extension */
      extension: string;
      /** Bundle in all the imports? */
      bundleImports: boolean;
      /** Export all the static imports? */
      exportAllStaticImports: boolean;
    };
    /** Config options for tools used in the build process. */
    tools?: {
      /** HTML Minifier settings */
      htmlMinifier?: htmlMinifierOptions;
      /** PostCSS settings */
      postcss?: {
        plugins?: any[];
        options?: object;
      }
    };
  };
  /** Component settings. */
  componenet: {
    /** The name of the component. */
    name?: string;
    /** @private The npm scope of the component */
    scope?: string | null;
    /** @private The path to the component when it is in node modules. */
    nodeModulesPath?: string;
  };
  /** Demo settings. */
  demos: {
    /** The file that imports the demo dependencies relative to `demos.path`. */
    importsFilename: string;
    /** The file that imports `demos.importsFilename` relative to `demos.path`. */
    importsImporterFilename: string;
    /** The path to the demos folder relative to the component's project root. */
    path: string;
  };
  /** Distribution settings. */
  dist: {
    /** The path to the distribution folder relative to the component's project root. */
    path: string;
  };
  /** Documentation settings. */
  docs: {
    /** The file that contains the analysis data relative to the component's project root. */
    analysisFilename: string;
    /** The file that imports the docs dependencies relative to the component's project root. */
    importsFilename: string;
    /** The file that imports `docs.importsFilename` relative to the component's project root. */
    importsImporterFilename: string;
    /** The index page of the documentation relative to the component's project root. */
    indexPage: string;
    /** The folder name for the node modules inside docs. */
    nodeModulesPath: string;
    /** The path to the documentation folder relative to the component's project root. */
    path: string;
  };
  /** Where the node module files are relative to the component's project root. */
  nodeModulesPath?: string;
  /** Publish settings. */
  publish: {
    /** Archives formats to upload to GitHub Release. */
    archiveFormats: {
      /** Tar archive. */
      tar: {
        /** File extension. */
        extension: string;
        /** Don't use this format. */
        ignore: boolean;
        /** Archive options. */
        options?: CoreOptions & TransformOptions & TarOptions;
      };
      /** Zip archive. */
      zip: {
        /** File extension. */
        extension: string;
        /** Don't use this format. */
        ignore: boolean;
        /** Archive options. */
        options?: CoreOptions & TransformOptions & ZipOptions;
      };
    };
    /** Run checks on the following files: (ignored if `runFileChecks` is false) */
    checkFiles: {
      package: boolean;
      script: boolean;
      module: boolean;
      license: boolean;
      readme: boolean;
    };
    /** Do a dry run? */
    dryrun: boolean;
    /** For the release - ignore non critical errors along the way. */
    force: boolean;
    /** Is the component project hosted on GitHub? */
    hostedOnGitHub: boolean;
    /** The name of the git master branch. */
    masterBranch: string;
    /** Regex for the prerelease branches. */
    prereleaseBranchRegex: RegExp;
    /** Check that the files are ready publishing? */
    runFileChecks: boolean;
    /** Check that git has everything in sync and ready for publishing? */
    runGitChecks: boolean;
  };
  /** Source settings. */
  src: {
    /** The path to the source folder relative to the component's project root. */
    path: string;
    /** The path to the entrypoint file relative to `src.path` */
    entrypoint?: string;
    /** The templates to be injected. */
    template?: {
      css?: string
      html?: string
    };
  };
  /** Temp settings. */
  temp: {
    /** The path to the temp folder relative to the component's project root. */
    path: string;
  };
  /** Test settings. */
  tests: {
    /** The path to the test folder relative to the component's project root. */
    path: string;
    /** The config for Web Component Tester. */
    wctConfig?: {
      plugins?: {
        local?: {
          browsers?: string[];
          browserOptions?: {
            chrome?: string[];
            firefox?: string[];
          };
        };
      };
      npm?: boolean;
    };
  };
  /** Contents of component project's package.json file. */
  package?: any;
  [key: string]: any;
}

const defaultConfig: IConfig = {
  build: {
    module: {
      build: true,
      extension: '.mjs'
    },
    script: {
      build: true,
      bundleImports: false,
      exportAllStaticImports: false,
      extension: '.min.js'
    },
    tools: {
      htmlMinifier: {
        collapseBooleanAttributes: true,
        collapseWhitespace: true,
        conservativeCollapse: false,
        ignoreCustomFragments: [/<demo-snippet>[\s\S]*<\/demo-snippet>/],

        // HtmlMinifier does not have support for async functions.
        // minifyCSS: (css: string, type: string, cb: (result: string) => void ) => {
        //   (async () => {
        //     const { css: processedCss } = await postcss(postcssPlugins).process(
        //       css
        //     );
        //     cb(processedCss);
        //   })();
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
      postcss: {
        options: {},
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
        ]
      }
    }
  },
  componenet: {},
  demos: {
    importsFilename: 'imports.mjs',
    importsImporterFilename: 'imports-importer.mjs',
    path: 'demo'
  },
  dist: {
    path: 'dist'
  },
  docs: {
    analysisFilename: 'analysis.json',
    importsFilename: 'docs-imports.mjs',
    importsImporterFilename: 'docs-imports-importer.mjs',
    indexPage: 'index.html',
    nodeModulesPath: 'scripts',
    path: 'docs'
  },
  nodeModulesPath: 'node_modules',
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
      license: true,
      module: true,
      package: true,
      readme: true,
      script: true
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
    path: 'src'
  },
  temp: {
    path: '.tmp'
  },
  tests: {
    path: 'test',
    wctConfig: {
      npm: true,
      plugins: {
        local: {
          browserOptions: {
            chrome: ['headless', 'disable-gpu'],
            firefox: ['-headless']
          },
          browsers: ['chrome', 'firefox']
        }
      }
    }
  }
};

export { defaultConfig, IConfig };
