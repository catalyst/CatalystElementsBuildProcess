// tslint:disable: no-default-export

/**
 * Rollup Config.
 */

import { join as joinPath } from 'path';
import { RollupOptions } from 'rollup';
import rollupPluginBabel from 'rollup-plugin-babel';
import rollupPluginCommonjs from 'rollup-plugin-commonjs';
import rollupPluginCopy from 'rollup-plugin-cpy'
import rollupPluginHashbang from 'rollup-plugin-hashbang';
import rollupPluginJson from 'rollup-plugin-json';
import rollupPluginNodeResolve from 'rollup-plugin-node-resolve';
import rollupPluginTypescript from 'rollup-plugin-typescript2';

import packageJson from '../package.json';

const indexConfig: RollupOptions = {
  input: 'src/index.ts',

  output: {
    dir: 'dist',
    entryFileNames: '[name].empty.mjs',
    format: 'esm'
  },

  plugins: [
    rollupPluginTypescript({
      tsconfig: 'src/tsconfig.json',
      useTsconfigDeclarationDir: true
    })
  ]
};

const cliConfig: RollupOptions = {
  input: 'src/bin/cli.ts',

  output: {
    dir: 'dist',
    sourcemap: false
  },

  plugins: [
    rollupPluginHashbang(),
    rollupPluginNodeResolve(),
    rollupPluginCommonjs(),
    rollupPluginTypescript({
      tsconfig: 'src/tsconfig.json',
      tsconfigOverride: {
        compilerOptions: {
          declaration: false  // declarations are handled by the index config.
        }
      }
    }),
    rollupPluginJson(),
    rollupPluginBabel({
      extensions: ['.js', '.mjs', '.ts']
    }),
    rollupPluginCopy([
      {
        files: '**/*.d.ts',
        dest: joinPath(process.cwd(), 'dist'),
        options: {
          cwd: joinPath(process.cwd(), 'src'),
          parents: true
        }
      }
    ])
  ],

  external: [
    // All the dependencies.
    ...Object.keys(packageJson.dependencies)
  ],

  treeshake: {
    pureExternalModules: true,
    propertyReadSideEffects: false,
    annotations: true
  }
};

function setConfigOutput(
  config: RollupOptions,
  outPath: string,
  format: RollupOptions['output']['format']
): RollupOptions {
  switch (format) {
    case 'esm':
      return {
        ...config,
        output: {
          ...config.output,
          entryFileNames: `${outPath}/[name].mjs`,
          chunkFileNames: 'common/[hash].mjs',
          format
        }
      };

    case 'cjs':
      return {
        ...config,
        output: {
          ...config.output,
          entryFileNames: `${outPath}/[name].js`,
          chunkFileNames: 'common/[hash].js',
          format
        }
      };

    default:
      // tslint:disable-next-line: no-throw
      throw new Error(`Config is not set up to handle the format "${format}"`);
  }
}

// Copy the template files.
const cliConfigCopyPlugin = rollupPluginCopy([
  {
    files: 'scripts/templates/**/*',
    dest: joinPath(process.cwd(), 'dist'),
    options: {
      cwd: joinPath(process.cwd(), 'src'),
      parents: true
    }
  }
]);

const cliConfigEsm = setConfigOutput(cliConfig, 'bin', 'esm');
const cliConfigCjs = setConfigOutput(cliConfig, 'bin', 'cjs');

const cliConfigEsmWithCopy = {
  ...cliConfigEsm,
  plugins: [
    ...cliConfigEsm.plugins,
    cliConfigCopyPlugin
  ]
};

// Only one of these plugins need the copy plugin.
const cliConfigs = [
  cliConfigEsmWithCopy,
  cliConfigCjs
];

export default [
  indexConfig,
  ...cliConfigs
];
