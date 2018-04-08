/* eslint-env node */

const gulp = require('gulp');
const buildProcess = require('.');

buildProcess.setConfig('./package.json', {
  dist: {
    path: '.'
  },
  publish: {
    checkFiles: {
      package: true,
      script: false,
      module: false,
      license: true,
      readme: true
    }
  }
});

gulp.task('lint', buildProcess.tasks.lint(gulp));
gulp.task('publish', buildProcess.tasks.publish(gulp));
