module.exports = {
  nodeModulesPath: 'node_modules',

  componenet: {
    name: null,
    scope: null,
    nodeModulesPath: null
  },

  build: {
    postcss: {
      options: {
        plugins: {
          'postcss-import': {},
          'postcss-cssnext': {
            features: {
              customProperties: false
            }
          },
          cssnano: {
            autoprefixer: false
          },
          'postcss-reporter': {}
        }
      }
    }
  },

  src: {
    path: 'src',
    entrypoint: null,
    template: null
  },

  dist: {
    path: 'dist'
  },

  demos: {
    path: 'demo',
    importsFilename: 'imports.mjs',
    importsImporterFilename: 'imports-importer.mjs'
  },

  docs: {
    path: 'docs',
    indexPage: 'index.html',
    nodeModulesPath: 'scripts',
    importsFilename: 'docs-imports.mjs',
    importsImporterFilename: 'docs-imports-importer.mjs',
    analysisFilename: 'analysis.json'
  },

  tests: {
    path: 'test',
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

  temp: {
    path: '.tmp'
  },

  package: null
};
