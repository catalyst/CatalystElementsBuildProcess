/**
 * Incomplete. See https://webpack.js.org/api/stats/
 */

declare type WebpackStats = Readonly<{
  /**
   * Version of webpack used for the compilation
   */
  readonly version: Readonly<string>;

  /**
   * Compilation specific hash
   */
  readonly hash: Readonly<string>;

  /**
   * Compilation time in milliseconds
   */
  readonly time: Readonly<number>;

  /**
   * A count of excluded modules when `exclude` is passed to the `toJson` method
   */
  readonly filteredModules: Readonly<number>;

  /**
   * path to webpack output directory
   */
  readonly outputPath: Readonly<string>;

  /**
   * Chunk name to emitted asset(s) mapping
   */
  readonly assetsByChunkName: ReadonlyArray<{
    [key: string]: Readonly<string> | ReadonlyArray<string>;
  }>;

  /**
   * A list of asset objects
   */
  readonly assets: ReadonlyArray<{
    /**
     * The chunks this asset contains
     */
    readonly chunkNames: ReadonlyArray<string>;

    /**
     * The chunk IDs this asset contains
     */
    readonly chunks: ReadonlyArray<number>;

    /**
     * Indicates whether or not the asset made it to the `output` directory
     */
    readonly emitted: Readonly<boolean>;

    /**
     * The `output` filename
     */
    readonly name: Readonly<string>;

    /**
     * The size of the file in bytes
     */
    readonly size: Readonly<number>;
  }>;

  /**
   * A list of chunk objects
   */
  readonly chunks: ReadonlyArray<any>;

  /**
   * A list of module objects
   */
  readonly modules: ReadonlyArray<any>;

  /**
   * A list of error strings
   */
  readonly errors: ReadonlyArray<any>;

  /**
   * A list of warning strings
   */
  readonly warnings: ReadonlyArray<any>;
}>;
