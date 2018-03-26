module.exports = {
  nodeModulesPath: 'node_modules',

  componenet: {
    name: null,
    scope: null,
    nodeModulesPath: null
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
    importsFilename: 'imports.js',
    importsImporterFilename: 'imports-importer.js'
  },

  docs: {
    path: 'docs',
    indexPage: 'index.html',
    nodeModulesPath: 'scripts',
    importsFilename: 'docs-imports.js',
    importsImporterFilename: 'docs-imports-importer.js',
    analysisFilename: 'analysis.json'
  },

  test: {
    path: 'test'
  },

  temp: {
    path: '.tmp'
  },

  packageInfo: null
};
