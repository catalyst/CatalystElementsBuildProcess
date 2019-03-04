// tslint:disable: no-default-export

/**
 * Rollup Config.
 */

import { resolve as resolvePath } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginHashbang from 'rollup-plugin-hashbang';
import rollupPluginJson from 'rollup-plugin-json';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import packageJson from '../package.json';

const chuckFileNamePattern = 'lib/common/[hash]';
const tsconfig = 'src/tsconfig.json';

const commonConfig = {
  output: {
    dir: '.',
    sourcemap: false
  },

  external: [
    // All the dependencies.
    ...Object.keys(packageJson.dependencies)
      .map((dependency) => {
        try {
          return require.resolve(dependency, { paths: [process.cwd()] });
        } catch (e) {
          return false;
        }
      })
      .filter((dependency) => dependency !== false) as ReadonlyArray<string>,

    // Dependencies not found by `require.resolve`.
    ...[
      'node_modules/cq-prolyfill/postcss-plugin.js'
    ]
    // tslint:disable-next-line: no-unnecessary-callback-wrapper
      .map((file) => resolvePath(file)),

    // Node builtins
    'util'
  ],

  treeshake: {
    pureExternalModules: true,
    propertyReadSideEffects: false,
    annotations: true
  }
};

const jsConfigEsm: RollupOptions = {
  ...commonConfig,

  input: 'src/lib/index.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `lib/[name].mjs`,
    chunkFileNames: `${chuckFileNamePattern}.mjs`,
    format: 'esm'
  },

  plugins: [
    rollupPluginTypescript({
      tsconfig
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

const jsConfigCjs: RollupOptions = {
  ...commonConfig,

  input: 'src/lib/index.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `lib/[name].js`,
    chunkFileNames: `${chuckFileNamePattern}.js`,
    format: 'cjs'
  },

  plugins: [
    rollupPluginTypescript({
      tsconfig,
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by jsConfigEsm.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

const cliConfig: RollupOptions = {
  ...commonConfig,

  input: 'src/bin/cli.ts',

  output: {
    ...commonConfig.output,
    entryFileNames: `bin/[name].js`,
    chunkFileNames: `${chuckFileNamePattern}.js`,
    format: 'cjs'
  },

  plugins: [
    rollupPluginHashbang(),
    rollupPluginTypescript({
      tsconfig,
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by jsConfigEsm.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    })
  ]
};

export default [
  jsConfigEsm,
  jsConfigCjs,
  cliConfig
];
