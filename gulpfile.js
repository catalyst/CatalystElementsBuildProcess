/* eslint-env node */

const gulp = require('gulp');
const buildProcess = require('.');

buildProcess.setConfig('./package.json', {
  publish: {
    force: true
  }
});

gulp.task('lint', buildProcess.tasks.lint(gulp));
gulp.task('prepublish', buildProcess.tasks.prepublish(gulp));
