export default (() => {
  // tslint:disable-next-line: no-any
  const presets: ReadonlyArray<string | [string, any]> = [
    require.resolve('@babel/preset-typescript')
  ];
  const plugins: ReadonlyArray<string> = [
    require.resolve('@babel/plugin-syntax-dynamic-import'),
    require.resolve('babel-plugin-unassert')
  ];

  const retainLines = true;

  const shouldPrintComment = (comment: string) => {
    // Remove tslint comments.
    if (/^ *tslint\:/.test(comment)) {
      return false;
    }

    // Remove typescript compiler comments.
    if (/^ *\@ts-/.test(comment)) {
      return false;
    }

    // Keep all other comments.
    return true;
  };

  return {
    shouldPrintComment,
    retainLines,
    presets,
    plugins
  };
})();
