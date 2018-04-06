/* eslint-env node */

const gulp = require('gulp');
const buildProcess = require('.');

buildProcess.setConfig('./package.json', {
  dist: {
    path: '.'
  },
  publish: {
    force: true
  }
});

gulp.task('lint', buildProcess.tasks.lint(gulp));
gulp.task('publish', buildProcess.tasks.publish(gulp));
