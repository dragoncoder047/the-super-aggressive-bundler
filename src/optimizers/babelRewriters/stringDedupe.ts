import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export interface StringDedupeOptions {
    /**
     * The minimum number of times a string must be seen in the module before it will be put in the string table.
     * @default 3
     */
    minimumRepeat?: number;
    /**
     * Whether to treat property accesses as strings and replace them with a bracket access if that string gets replaced.
     * Useful when minifying codebases with lots of long property names, but carries a significant performance penalty.
     * @default false
     */
    includeProperties?: boolean;
    /**
     * Minimum length of a property for it to be considered for replacement if {@link includeProperties} is true.
     * @default 5
     */
    propertyMinimumLength?: number;
}

export function stringDedupe(options: StringDedupeOptions = {}): BabelRewriter {
    return ast => {
        const collector = new StringTableCollector(options.minimumRepeat ?? 3);
        const alsoDoProps = options.includeProperties ?? false;
        const minPropLength = options.propertyMinimumLength ?? 5;
        // first pass: find all the strings
        traverse(ast, {
            StringLiteral(path) {
                if (t.isImportDeclaration(path.parent) || t.isImportSpecifier(path.parent)) return;
                collector.add(path.node.value);
            },
            TemplateLiteral(path) {
                // skip tagged templates
                if (t.isTaggedTemplateExpression(path.parentPath?.node)) return;
                for (const q of path.node.quasis) {
                    const raw = q.value.cooked ?? q.value.raw;
                    if (raw && raw.length > 0) collector.add(raw);
                }
            },
            ObjectProperty(path) {
                if (!alsoDoProps) return;
                const { key, computed } = path.node;
                if (computed) return;
                if (t.isIdentifier(key) && key.name.length > minPropLength) collector.add(key.name);
                if (t.isStringLiteral(key) && key.value.length > minPropLength) collector.add(key.value);
            },
            MemberExpression(path) {
                if (!alsoDoProps) return;
                const { property, computed } = path.node;
                if (computed) return;
                if (t.isIdentifier(property) && property.name.length > minPropLength) collector.add(property.name);
            }
        });

        collector.computeExpressions();

        // second pass: replace the strings
        traverse(ast, {
            StringLiteral(path) {
                if (t.isImportDeclaration(path.parent) || t.isImportSpecifier(path.parent)) return;
                const str = path.node.value;
                if (collector.isReplaced(str)) {
                    path.replaceWith(collector.getReplacementExpression(str));
                }
            },

            TemplateLiteral(path) {
                if (t.isTaggedTemplateExpression(path.parentPath?.node)) return;

                const { quasis, expressions } = path.node;

                // wow, it's just normal string
                if (quasis.length === 1 && expressions.length === 0) {
                    const raw = quasis[0].value.cooked ?? quasis[0].value.raw;
                    if (collector.isReplaced(raw)) {
                        path.replaceWith(collector.getReplacementExpression(raw));
                    }
                    return;
                }

                var firstIsString = false;
                for (var i = 0; i < quasis.length; i++) {
                    const raw = quasis[i].value.cooked ?? quasis[i].value.raw;
                    if (collector.isReplaced(raw) && raw.length > 0) {
                        quasis.splice(i, 1,
                            t.templateElement({ cooked: "", raw: "" }, false),
                            t.templateElement({ cooked: "", raw: "" }, i === expressions.length));
                        expressions.splice(i, 0, collector.getReplacementExpression(raw) as any);
                        if (i === 0) firstIsString = true;
                        i++;
                    }
                }
                // if it's all quasis, with no string chunks left, make it a plus expression
                if (quasis.every(quasi => quasi.value.cooked === "")) {
                    const reducer = (prev: t.Expression, cur: t.Expression) => t.binaryExpression("+", prev, cur);
                    path.replaceWith(t.parenthesizedExpression((firstIsString ? expressions.slice(1).reduce(reducer as any, expressions[0]) : expressions.reduce(reducer as any, t.stringLiteral(""))) as t.Expression));
                }
            },
            ObjectProperty(path) {
                if (!alsoDoProps) return;
                const node = path.node;
                if (node.computed) return;
                if (t.isIdentifier(node.key) && node.key.name.length > minPropLength && collector.isReplaced(node.key.name)) {
                    node.key = collector.getReplacementExpression(node.key.name);
                    node.computed = true as false; // STUPID
                } else if (t.isStringLiteral(node.key) && node.key.value.length > minPropLength && collector.isReplaced(node.key.value)) {
                    node.key = collector.getReplacementExpression(node.key.value);
                    node.computed = true as false; // STUPID
                }
            },
            MemberExpression(path) {
                if (!alsoDoProps) return;
                const node = path.node;
                if (node.computed) return;
                if (t.isIdentifier(node.property) && node.property.name.length > minPropLength && collector.isReplaced(node.property.name)) {
                    node.property = collector.getReplacementExpression(node.property.name);
                    node.computed = true as false; // STUPID
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
