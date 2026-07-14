import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export interface StringDedupeOptions {
    /**
     * The minimum number of times a string must be seen in the module before it will be put in the string table.
     * @default 3
     */
    minimumRepeat?: number;
}

export function stringDedupe(options: StringDedupeOptions = {}): BabelRewriter {
    return ast => {
        const collector = new StringTableCollector(options.minimumRepeat ?? 3);
        // first pass: find all the strings
        traverse(ast, {
            StringLiteral(path) {
                collector.add(path.node.value);
            },
            TemplateLiteral(path) {
                // skip tagged templates
                if (t.isTaggedTemplateExpression(path.parentPath?.node)) return;
                for (const q of path.node.quasis) {
                    const raw = q.value.cooked ?? q.value.raw;
                    if (raw) collector.add(raw);
                }
            }
        });

        collector.computeExpressions();

        // second pass: replace the strings
        traverse(ast, {
            StringLiteral(path) {
                // console.log("pass 2: visiting string literal", path.node.value);
                const str = path.node.value;
                if (collector.isReplaced(str)) {
                    // console.log("replaced");
                    path.replaceWith(collector.getReplacementExpression(str));
                }
            },

            TemplateLiteral(path) {
                // console.log("pass 2: visiting template literal", path.node.quasis.map(e => e.value.raw));
                if (t.isTaggedTemplateExpression(path.parentPath?.node)) return;

                const { quasis, expressions } = path.node;

                // wow, it's just normal string
                if (quasis.length === 1 && expressions.length === 0) {
                    const raw = quasis[0].value.cooked ?? quasis[0].value.raw
                    if (collector.isReplaced(raw)) {
                        path.replaceWith(collector.getReplacementExpression(raw));
                    }
                    return;
                }

                for (var i = 0; i < quasis.length; i++) {
                    const raw = quasis[i].value.cooked ?? quasis[i].value.raw
                    if (collector.isReplaced(raw)) {
                        quasis.splice(i, 1,
                            t.templateElement({ cooked: "", raw: "" }, false),
                            t.templateElement({ cooked: "", raw: "" }, i === expressions.length));
                        expressions.splice(i, 0, collector.getReplacementExpression(raw) as any);
                        i++;
                    }
                }
                // if it's all quasis, with no string chunks left, make it a plus expression
                if (quasis.every(quasi => quasi.value.cooked === "")) {
                    path.replaceWith(t.parenthesizedExpression(expressions.reduce((prev, cur) => t.binaryExpression("+", prev as t.Expression, cur as t.Expression), t.stringLiteral("")) as t.Expression));
                }
            }
        });

        // third: insert variables
        const vars = collector.getAllVars();
        if (vars.declarations.length) ast.program.body.splice(0, 0, vars as any);

        return ast;
    }
}

class StringTableCollector {
    seenStrings!: string[];
    variables!: Record<string, string>;
    counts = new Map<string, number>();
    constructor(public minCount: number) { }
    add(string: string) {
        this.counts.set(string, 1 + (this.counts.get(string) ?? 0));
    }
    computeExpressions() {
        this.seenStrings = [...this.counts.keys()];
        this.variables = Object.fromEntries(this.seenStrings.map(s => [s, `string${this.seenStrings.indexOf(s)}_${toVarName(s)}_${Math.random().toString(36).slice(2, 10)}`]));
    }
    isReplaced(string: string) {
        return (this.counts.get(string) ?? 0) >= this.minCount;
    }
    getReplacementExpression(string: string) {
        return t.identifier(this.variables[string]);
    }
    getAllVars() {
        const declarators = [];
        for (var string of this.seenStrings) {
            if (this.isReplaced(string)) {
                declarators.push(t.variableDeclarator(t.identifier(this.variables[string]), t.stringLiteral(string)));
            }
        }
        return t.variableDeclaration("var", declarators);
    }
}

function toVarName(str: string): string {
    return str
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^([0-9])/, "_$1");
}
