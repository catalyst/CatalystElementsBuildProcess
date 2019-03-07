import del from 'del';
import { render as renderEjs } from 'ejs';
import { copy, outputFile, readFile } from 'fs-extra';
import { minify as minifyHTML } from 'html-minifier';
import JSON5 from 'json5';
import { Options as SassOptions, render as renderSassCbf, Result as SassResult } from 'node-sass';
import { dirname, join as joinPaths, resolve as resolvePath } from 'path';
import postcss from 'postcss';
import { rollup } from 'rollup';
import { minify as minifyJS } from 'terser';
import { promisify } from 'util';
import webpack from 'webpack';

import { Config } from '../config';
import { minScript as terserConfigScript } from '../config/build/terser.config.prod';
import { EnvironmentError } from '../errors';
import { Options } from '../types';

/**
 * Run the build process.
 */
export async function run(options: Options, config: Config): Promise<void> {
  return buildDocs(options, config);
}

const renderSass = promisify<SassOptions, SassResult>(renderSassCbf);

const es5AdapterPath = 'webcomponentsjs/custom-elements-es5-adapter.js';

/**
 * Build the docs for the development environment.
 */
export async function buildDocs(options: Options, config: Config): Promise<void> {
  await del(config.docs.path);
  await compile(options, config);
}

/**
 * Proccess the files the make up the docs and get them ready to generate the docs.
 */
async function compile(options: Options, config: Config): Promise<void> {
  const webComponentsPolyfillsBaseDir = dirname(dirname(require.resolve('@webcomponents/webcomponentsjs/package.json')));

  if (options.env === 'production') {
    const es5AdapterLoaderJs = renderEjs(
      await readFile(joinPaths(config.packageRoot, config.docs.templateFiles.es5AdapterLoader), 'utf-8'),
      {
        customElementsEs5AdapterPath: joinPaths(webComponentsPolyfillsBaseDir, es5AdapterPath)
      },
      {}
    );
    await outputFile(
      resolvePath(config.temp.path, config.docs.path, 'es5-adapter-loader.js'),
      es5AdapterLoaderJs
    );
  }

  const [[mainModule, moduleFiles], mainScript] = await Promise.all([
    compileESM(options, config),
    compileIIFE(options, config)
  ]);

  await compileFinalizing(
    options,
    config,
    webComponentsPolyfillsBaseDir,
    moduleFiles,
    mainModule,
    mainScript
  );
}

async function compileESM(options: Options, config: Config): Promise<[string, Array<string>]> {
  console.log('Building ESM with rollup.');

  const rollupConfigs =
      options.env === 'production' || options.env === 'test'
    ? await (await import('../config/build-docs/rollup.config.prod')).getAllConfigs(config)
    : options.env === 'development'
    ? await (await import('../config/build-docs/rollup.config.dev')).getAllConfigs(config)
    : new EnvironmentError();

  if (rollupConfigs instanceof Error) {
    return Promise.reject(rollupConfigs);
  }

  const rollupBuilds = await Promise.all(
    rollupConfigs.map(async (rollupConfig) => {
      return rollup(rollupConfig);
    })
  );

  // Compile the JavaScript.
  const buildOutputs = await Promise.all(
    rollupBuilds.map(async (rollupBuild, index) => {
      const rollupConfig = rollupConfigs[index];
      if (rollupConfig.output === undefined) {
        return Promise.reject(new Error('output not defined'));
      }
      return rollupBuild.write(rollupConfig.output);
    })
  );
  const moduleFiles = buildOutputs[0].output.reduce((r, output) => [...r, output.fileName], []);
  return [
    moduleFiles[0],
    moduleFiles
  ];
}

async function compileIIFE(options: Options, config: Config): Promise<string> {
  console.log('Building IIFE with webpack.');

  // Rollup can't current generate iife when the source code uses dynamic imports.
  // WebPack is used instead to generate the es5 version of the docs.
  const webpackConfig =
      options.env === 'production' || options.env === 'test'
    ? await (await import('../config/build-docs/webpack.config.prod')).getConfig(config)
    : options.env === 'development'
    ? await (await import('../config/build-docs/webpack.config.dev')).getConfig(config)
    : new EnvironmentError();

  if (webpackConfig instanceof Error) {
    return Promise.reject(webpackConfig);
  }
  const compiler = webpack(webpackConfig);

  const runCompiler = promisify(compiler.run.bind(compiler) as typeof compiler.run);
  const stats = await runCompiler();

  // tslint:disable: no-unsafe-any
  const statsData = stats.toJson('normal');
  const mainScript: string = statsData.assetsByChunkName.main;
  // tslint:enable: no-unsafe-any

  console.info(
    stats.toString({
      chunks: false,
      colors: true
    })
  );

  return mainScript;
}

async function compileFinalizing(
  options: Options,
  config: Config,
  webComponentsPolyfillsBaseDir: string,
  moduleFiles: ReadonlyArray<string>,
  mainModule: string,
  mainScript: string
): Promise<void> {
  console.log('Finalizing Build.');

  const analysis = await readFile(resolvePath(config.docs.analysisFilename), 'utf-8');
  await outputFile(
    resolvePath(config.docs.path, config.docs.analysisFilename),
    options.env === 'production'
      ? JSON.stringify(JSON5.parse(analysis))
      : JSON.stringify(JSON5.parse(analysis), undefined, 2)
  );

  const webComponentsPolyfills: ReadonlyArray<string> = [
    'webcomponentsjs/webcomponents-loader.js',
    'shadycss/scoping-shim.min.js',
    es5AdapterPath
  ];
  const webComponentsPolyfillAssets: ReadonlyArray<string> = [
    'webcomponentsjs/bundles'
  ];

  const webComponentsPolyfillDist = webComponentsPolyfills.map((file) => ({
    path: joinPaths(config.docs.nodeModulesPath, file),
    // Don't load the following files in the index page. They will be loaded when needed else where.
    includeInIndex: !([
      es5AdapterPath
    ].includes(file))
  }));

  const copyPolyfillSrcFileAssets = webComponentsPolyfillAssets.map(async (file) => copy(
    joinPaths(webComponentsPolyfillsBaseDir, file),
    resolvePath(config.docs.path, config.docs.nodeModulesPath, file)
  ));

  if (options.env === 'production') {
    // Minify the polyfill src files and put them into the dist folder.
    await Promise.all([
      ...webComponentsPolyfills.map(async (file, i) => {
        const js = await readFile(joinPaths(webComponentsPolyfillsBaseDir, file), 'utf-8');

        const minifiedJS = minifyJS(js, terserConfigScript).code;

        await outputFile(
          resolvePath(config.docs.path, webComponentsPolyfillDist[i].path),
          minifiedJS
        );
      }),

      ...copyPolyfillSrcFileAssets
    ]);
  } else {
    // Copy the polyfill src files to the dist folder.
    await Promise.all([
      ...webComponentsPolyfills.map(async (file, i) => copy(
        joinPaths(webComponentsPolyfillsBaseDir, file),
        resolvePath(config.docs.path, webComponentsPolyfillDist[i].path)
      )),

      ...copyPolyfillSrcFileAssets
    ]);
  }

  // Create the list of polyfills to load.
  const loadPolyfills = webComponentsPolyfillDist.reduce<ReadonlyArray<string>>(
    (r, b) => {
      if (!b.includeInIndex) {
        return r;
      }

      return [
        ...r,
        b.path
      ];
    },
    []
  );

  const essentialAssets: ReadonlyArray<string> = [
    config.docs.analysisFilename
  ];

  const css = await compileCSS(options, config);
  await compileHTML(
    options,
    config,
    mainModule,
    mainScript,
    loadPolyfills,
    css,
    {
       modules: moduleFiles,
       scripts: loadPolyfills,
       json: essentialAssets
    }
  );
}

async function compileHTML(
  options: Options,
  config: Config,
  mainModule: string,
  mainScript: string,
  polyfillFiles: ReadonlyArray<string>,
  inlineCss: string,
  preloadFiles: {
    readonly modules: ReadonlyArray<string>;
    readonly scripts: ReadonlyArray<string>;
    readonly json: ReadonlyArray<string>;
  }
): Promise<void> {

  const preloadTags: ReadonlyArray<string> = [
    ...preloadFiles.modules.map((file) => {
      return `<link rel="modulepreload" href="${file}">`;
    }),
    ...preloadFiles.scripts.map((file) => {
      return `<link rel="preload" href="${file}" as="script">`;
    }),
    ...preloadFiles.json.map((file) => {
      return `<link rel="preload" href="${file}" as="fetch" type="application/json" crossorigin="anonymous">`;
    })
  ];

  const description = 'Documentation for the the catalyst-labelable-mixin.';
  const title = 'catalyst-labelable-mixin Docs';

  const es5AdapterLoaderScript =
    options.env === 'production'
      ? (await readFile(resolvePath(config.temp.path, config.docs.path, 'es5-adapter-loader.min.js'), 'utf-8')).trim()
      : '';

  const indexHtmlEjs = await readFile(joinPaths(config.packageRoot, config.docs.templateFiles.indexHtml), 'utf-8');

  const indexHTML = renderEjs(indexHtmlEjs, {
    env: options.env,
    title,
    description,
    mainModuleSrc: mainModule,
    mainScriptSrc: mainScript,
    preloadTags,
    es5AdapterLoaderScript,
    polyfillScriptsSrc: polyfillFiles,
    style: inlineCss
  }, {});

  const output =
    options.env === 'production'
      ? minifyHTML(indexHTML, {
        collapseBooleanAttributes: true,
        collapseWhitespace: true,
        minifyCSS: true,
        minifyJS: true,
        removeComments: true,
        removeOptionalTags: true,
        removeRedundantAttributes: true,
        removeScriptTypeAttributes: true,
        removeStyleLinkTypeAttributes: true,
        sortAttributes: true,
        sortClassName: true,
        useShortDoctype: true
      })
      : indexHTML;

  await outputFile(
    resolvePath(config.docs.path, 'index.html'),
    output
  );
}

async function compileCSS(options: Options, config: Config): Promise<string> {
  const css = (await renderSass({
      file: joinPaths(config.packageRoot, config.docs.templateFiles.style),
      outputStyle: 'expanded'
    }))
      .css.toString('utf-8');

  const postcssConfig =
      options.env === 'production'
    ? (await import('../config/build-docs/postcss.config.prod')).getConfig()
    : options.env === 'development' || options.env === 'test'
    ? (await import('../config/build-docs/postcss.config.dev')).getConfig()
    : new EnvironmentError();

  if (postcssConfig instanceof Error) {
    return Promise.reject(postcssConfig);
  }

  const processedCss = (await (
    postcss(postcssConfig.plugins)
      .process(css, postcssConfig.options) as PromiseLike<postcss.Result>
  )).css;

  return processedCss.replace(/\n/g, '');
}
