/* eslint-env node */

const del = require('del');
const fs = require('fs');
const gulp = require('gulp');
const modifyFile = require('gulp-modify-file');
const ts = require('gulp-typescript');
let lib = null;

if (fs.existsSync('./dist/lib/index.js')) {
  lib = require('./dist');
}

const tasksToImport = ['lint', 'publish', 'publishDry'];
let tasksMap;
try {
  tasksMap = {};
  for (const task of tasksToImport) {
    tasksMap[task] = lib.tasks[task](task);
  }
} catch (error) {
  tasksMap = {};
  for (const task of tasksToImport) {
    tasksMap[task] = function() {
      throw new Error(
        `"${task}" not available - run build tasks first to enable it.`
      );
    };
  }
}

for (const [task, taskFunc] of Object.entries(tasksMap)) {
  gulp.task(task, taskFunc);
}

gulp.task('build', () => {
  return new Promise(async (resolve, reject) => {
    try {
      const tsProject = ts.createProject('tsconfig.json');
      const tsResult = gulp.src('./src/**/*.ts').pipe(tsProject());

      await del('./dist');

      let waitingFor = 3;
      const cb = () => {
        waitingFor -= 1;
        if (waitingFor === 0) {
          resolve();
        }
      };

      tsResult
        .pipe(gulp.dest('./dist/lib'))
        .on('finish', cb)
        .on('error', error => {
          throw error;
        });

      gulp
        .src(['./LICENSE', './README.md'])
        .pipe(gulp.dest('./dist'))
        .on('finish', cb)
        .on('error', error => {
          throw error;
        });

      gulp
        .src('./package.json')
        .pipe(
          modifyFile(content => {
            const json = JSON.parse(content);
            delete json.devDependencies;
            delete json.scripts;
            return JSON.stringify(json, null, 2);
          })
        )
        .pipe(gulp.dest('./dist'))
        .on('finish', cb)
        .on('error', error => {
          throw error;
        });
    } catch (error) {
      reject(error);
    }
  });
});
