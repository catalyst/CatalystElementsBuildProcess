/**
 * Config Settings.
 */

// Libraries.
import {
  ArchiverOptions,
  CoreOptions,
  TarOptions,
  TransformOptions,
  ZipOptions
} from 'archiver';
import colorGuard from 'colorguard';
import postcssCqProlyfill from 'cq-prolyfill/postcss-plugin';
import cssMQPacker from 'css-mqpacker';
import cssnano from 'cssnano';
import { Options as htmlMinifierOptions } from 'html-minifier';
import postcss from 'postcss';
import postcssAutoReset from 'postcss-autoreset';
import postcssCssNext from 'postcss-cssnext';
import postcssFontMagician from 'postcss-font-magician';
import postcssImageSet from 'postcss-image-set-polyfill';
import postcssImport from 'postcss-import';
import postcssInitial from 'postcss-initial';
import postcssPresetEnv from 'postcss-preset-env';
import postcssReporter from 'postcss-reporter';

// tslint:disable:no-reserved-keywords
declare interface IConfig {
  /**
   * Build settings.
   */
  readonly build: {
    /**
     * Module settings
     */
    readonly module: {
      /**
       * Build the module?
       */
      readonly build: boolean;

      /**
       * Module extension
       */
      readonly extension: string;
    };

    /**
     * Script settings
     */
    readonly script: {
      /**
       * Build the script?
       */
      readonly build: boolean;

      /**
       * Script extension
       */
      readonly extension: string;

      /**
       * Bundle in all the imports?
       */
      readonly bundleImports: boolean;

      /**
       * Export all the static imports?
       */
      readonly exportAllStaticImports: boolean;
    };

    /**
     * Config options for tools used in the build process.
     */
    readonly tools: {
      /**
       * HTML Minifier settings
       */
      readonly htmlMinifier?: htmlMinifierOptions;

      /**
       * PostCSS settings
       */
      readonly postcss?: {
        readonly plugins?: ReadonlyArray<postcss.AcceptedPlugin>;
        readonly options?: postcss.ProcessOptions;
      };
    };
  };

  /**
   * Component settings.
   */
  readonly componenet: {
    /**
     * The name of the component.
     */
    readonly name?: string;

    /**
     * The npm scope of the component
     */
    readonly scope?: string | null;

    /**
     * The path to the component when it is in node modules.
     */
    readonly nodeModulesPath?: string;
  };

  /**
   * Demo settings.
   */
  readonly demos: {
    /**
     * The file that imports the demo dependencies relative to `demos.path`.
     */
    readonly importsFilename: string;

    /**
     * The file that imports `demos.importsFilename` relative to `demos.path`.
     */
    readonly importsImporterFilename: string;

    /**
     * The path to the demos folder relative to the component's project root.
     */
    readonly path: string;
  };

  /**
   * Distribution settings.
   */
  readonly dist: {
    /**
     * The path to the distribution folder relative to the component's project root.
     */
    readonly path: string;
  };

  /**
   * Documentation settings.
   */
  readonly docs: {
    /**
     * The file that contains the analysis data relative to the component's project root.
     */
    readonly analysisFilename: string;

    /**
     * The file that imports the docs dependencies relative to the component's project root.
     */
    readonly importsFilename: string;

    /**
     * The file that imports `docs.importsFilename` relative to the component's project root.
     */
    readonly importsImporterFilename: string;

    /**
     * The index page of the documentation relative to the component's project root.
     */
    readonly indexPage: string;

    /**
     * The folder name for the node modules inside docs.
     */
    readonly nodeModulesPath: string;

    /**
     * The path to the documentation folder relative to the component's project root.
     */
    readonly path: string;
  };

  /**
   * Where the node module files are relative to the component's project root.
   */
  readonly nodeModulesPath: string;

  /**
   * Publish settings.
   */
  readonly publish: {
    /**
     * Archives formats to upload to GitHub Release.
     */
    readonly archiveFormats: {
      /**
       * Tar archive.
       */
      readonly tar: {
        /**
         * File extension.
         */
        readonly extension: string;

        /**
         * Don't use this format.
         */
        readonly ignore: boolean;

        /**
         * Archive options.
         */
        readonly options: CoreOptions & TransformOptions & TarOptions;
      };

      /**
       * Zip archive.
       */
      readonly zip: {
        /**
         * File extension.
         */
        readonly extension: string;

        /**
         * Don't use this format.
         */
        readonly ignore: boolean;

        /**
         * Archive options.
         */
        readonly options: CoreOptions & TransformOptions & ZipOptions;
      };
      readonly [key: string]: {
        readonly extension: string;
        readonly ignore: boolean;
        readonly options: ArchiverOptions;
      };
    };

    /**
     * Run checks on the following files: (ignored if `runFileChecks` is false)
     */
    readonly checkFiles: {
      readonly package: boolean;
      readonly script: boolean;
      readonly module: boolean;
      readonly license: boolean;
      readonly readme: boolean;
    };

    /**
     * Do a dry run?
     */
    readonly dryrun: boolean;

    /**
     * For the release - ignore non critical errors along the way.
     */
    readonly force: boolean;

    /**
     * Is the component project hosted on GitHub?
     */
    readonly hostedOnGitHub: boolean;

    /**
     * The name of the git master branch.
     */
    readonly masterBranch: string;

    /**
     * Regex for the prerelease branches.
     */
    readonly prereleaseBranchRegex: RegExp;

    /**
     * Check that the files are ready publishing?
     */
    readonly runFileChecks: boolean;

    /**
     * Check that git has everything in sync and ready for publishing?
     */
    readonly runGitChecks: boolean;
  };

  /**
   * Source settings.
   */
  readonly src: {
    /**
     * The path to the source folder relative to the component's project root.
     */
    readonly path: string;

    /**
     * The path to the entrypoint file relative to `src.path`
     */
    readonly entrypoint?: string;

    /**
     * The templates to be injected.
     */
    readonly template?: {
      readonly css?: string;
      readonly html?: string;
    };
  };

  /**
   * Temp settings.
   */
  readonly temp: {
    /**
     * The path to the temp folder relative to the component's project root.
     */
    readonly path: string;
  };

  /**
   * Test settings.
   */
  readonly tests: {
    /**
     * The path to the test folder relative to the component's project root.
     */
    readonly path: string;

    /**
     * The config for Web Component Tester.
     */
    readonly wctConfig?: {
      readonly plugins?: {
        readonly local?: {
          readonly browsers?: ReadonlyArray<string>;
          readonly browserOptions?: {
            readonly chrome?: ReadonlyArray<string>;
            readonly firefox?: ReadonlyArray<string>;
          };
        };
      };
      readonly npm?: boolean;
    };
  };

  /**
   * Contents of component project's package.json file.
   */
  readonly package?: {
    readonly [key: string]: any;
  };
  readonly [key: string]: any;
}
// tslint:enable:no-reserved-keywords

const defaultConfig: IConfig = {
  build: {
    module: {
      build: true,
      extension: '.mjs'
    },
    script: {
      build: true,
      extension: '.min.js',
      bundleImports: false,
      exportAllStaticImports: false
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
