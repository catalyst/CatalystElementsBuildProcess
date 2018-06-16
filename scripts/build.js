#!/usr/bin/env node

const del = require('del');
const fs = require('fs-extra');
const glob = require('glob');
const promisepipe = require('promisepipe');
const ts = require('gulp-typescript');
const util = require('util');
const vinyl = require('vinyl-fs');

/**
 * Build the dist.
 */
async function build() {
  await del('./dist');

  const compileTypeScript = promisepipe(
    vinyl.src('./src/**/*.ts'),
    ts.createProject('tsconfig.json')(),
    vinyl.dest('./dist')
  ).catch(error => console.info(error.message));

  const copyFiles = ['LICENSE', 'README.md'].map(file =>
    fs.copy(`./${file}`, `./dist/${file}`)
  );

  const buildPackage = async () => {
    const json = await fs.readJson('./package.json');
    delete json.devDependencies;
    delete json.scripts;
    await fs.writeJson(`./dist/package.json`, json, { spaces: 2 });
  };

  await Promise.all([compileTypeScript, ...copyFiles, buildPackage()]);

  const chmod = util.promisify(fs.chmod);
  const g = util.promisify(glob);
  const files = await g('./dist/bin/**/*.js');
  await Promise.all(files.map(async file => chmod(file, 0o754)));
}

build();
