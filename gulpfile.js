/* eslint-env node */

const del = require('del');
const gulp = require('gulp');
const modifyFile = require('gulp-modify-file');
const ts = require('gulp-typescript');
const lib = require('./dist');

gulp.task('lint', lib.tasks.lint(gulp));
gulp.task('publish', lib.tasks.publish(gulp));
gulp.task('publish-dry', lib.tasks.publishDry(gulp));

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
