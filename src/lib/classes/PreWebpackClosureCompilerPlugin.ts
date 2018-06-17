// tslint:disable:no-if-statement

// Libraries.
import { generate } from 'escodegen';
import { parseScript } from 'esprima';
import { Node } from 'estree'; // tslint:disable-line:no-implicit-dependencies
import * as webpack from 'webpack';
import { RawSource } from 'webpack-sources';

/**
 * Process the webpack output before handing it off to the WebpackClosureCompilerPlugin.
 */
export class PreWebpackClosureCompilerPlugin {
  /**
   * Contains the new segments of code to replace original code with in the source code.
   *
   * Can't be done without a mutable array due to the implementation of `parseScript`
   */
  private readonly _mutableCodeReplacements: Array<{
    readonly start: number;
    readonly end: number;
    readonly replacementCode: string;
  }>;

  /**
   * Construct this plugin.
   */
  public constructor() {
    this._mutableCodeReplacements = [];
  }

  /**
   * Apply this plugin.
   *
   * @param compiler - The webpack compiler
   */
  public apply(compiler: webpack.Compiler): void {
    compiler.plugin(
      'compilation',
      (mutableCompilation: webpack.compilation.Compilation) => {
        mutableCompilation.plugin(
          'optimize-chunk-assets',
          (
            chunks: ReadonlyArray<webpack.compilation.Chunk>,
            done: () => void
          ) => {
            chunks.forEach((chunk) => {
              chunk.files.forEach((file) => {
                const source =
                  mutableCompilation.assets[file].source() as string;

                // Parse the source with the delegate to generate the replacement information.
                parseScript(source, {}, this._processNode.bind(this));

                // Update the source code with the replacements.
                const updatedSource = this._mutableCodeReplacements.reduce(
                  (code, codeUpdate) => {
                    return (
                      code.slice(0, codeUpdate.start) +
                      codeUpdate.replacementCode +
                      code.slice(codeUpdate.end)
                    );
                  },
                  source
                );

                // Replace the file's source code with the modified version.
                mutableCompilation.assets[file] = new RawSource(updatedSource);
              });
            });
            done();
          }
        );
      }
    );
  }

  /**
   * Process a node.
   *
   * @param node - An esprima node object
   * @param meta - Metadata about the node
   */
  // tslint:disable-next-line:no-any
  private _processNode(node: Node, meta: any): void {
    if (
      node.type !== 'ClassDeclaration' ||
      node.id === null ||
      node.superClass == undefined ||
      node.superClass.type !== 'MemberExpression'
    ) {
      return;
    }

    const className = node.id.name;
    const classBody = node.body;
    const superClassVar = `${className}_SuperClass_${
      crypto
        .getRandomValues(new Uint32Array(2))[0]
        .toString(16)
      }`;

    if (
      !node.superClass.computed ||
      node.superClass.object.type !== 'Identifier'
    ) {
      return;
    }

    const object = node.superClass.object.name;
    const property =
      node.superClass.property.type === 'Literal'
        ? `"${node.superClass.property.value}"`
        : node.superClass.property.type === 'Identifier'
          ? `${node.superClass.property.name}`
          : undefined;

    if (property === undefined) {
      return;
    }

    this._mutableCodeReplacements.push({
      start: meta.start.offset,
      end: meta.end.offset,
      replacementCode: `const ${superClassVar} = ${object}[${property}];
class ${className} extends ${superClassVar} ${generate(classBody)}`
    });
  }
}
