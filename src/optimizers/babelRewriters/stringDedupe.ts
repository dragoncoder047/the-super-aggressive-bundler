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
    /**
     * Splits strings into repeated substrings and then concatenates them at runtime.
     * @default true
     */
    aggressiveSplitting?: boolean;
    /**
     * Minimum length of substring to consider for extraction.
     * @default 2
     */
    aggressiveMinLength?: number;
    /**
     * Stop extracting substrings when benefit falls below this threshold.
     * @default 5
     */
    aggressiveBenefitThreshold?: number;
}

export function stringDedupe(options: StringDedupeOptions = {}): BabelRewriter {
    return ast => {
        const collector = new StringTableCollector(
            options.minimumRepeat ?? 3,
            options.aggressiveMinLength ?? 2,
            options.aggressiveBenefitThreshold ?? 5,
            options.aggressiveSplitting ?? true,
        );
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
                for (var q of path.node.quasis) {
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
                const expr = collector.getReplacementExpression(str);
                if (expr) {
                    path.replaceWith(expr);
                }
            },

            TemplateLiteral(path) {
                if (t.isTaggedTemplateExpression(path.parentPath?.node)) return;

                const { quasis, expressions } = path.node;

                // wow, it's just normal string
                if (quasis.length === 1 && expressions.length === 0) {
                    const raw = quasis[0].value.cooked ?? quasis[0].value.raw;
                    const expr = collector.getReplacementExpression(raw);
                    if (expr) {
                        path.replaceWith(expr);
                    }
                    return;
                }

                var firstIsString = false;
                for (var i = 0; i < quasis.length; i++) {
                    const raw = quasis[i].value.cooked ?? quasis[i].value.raw;
                    const expr = collector.getReplacementExpression(raw);
                    if (expr && raw.length > 0) {
                        quasis.splice(i, 1,
                            t.templateElement({ cooked: "", raw: "" }, false),
                            t.templateElement({ cooked: "", raw: "" }, i === expressions.length));
                        expressions.splice(i, 0, expr);
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
                if (t.isIdentifier(node.key) && node.key.name.length > minPropLength && collector.getReplacementExpression(node.key.name)) {
                    node.key = collector.getReplacementExpression(node.key.name) as any;
                    node.computed = true as false; // STUPID
                } else if (t.isStringLiteral(node.key) && node.key.value.length > minPropLength && collector.getReplacementExpression(node.key.value)) {
                    node.key = collector.getReplacementExpression(node.key.value) as any;
                    node.computed = true as false; // STUPID
                }
            },
            MemberExpression(path) {
                if (!alsoDoProps) return;
                const node = path.node;
                if (node.computed) return;
                if (t.isIdentifier(node.property) && node.property.name.length > minPropLength && collector.getReplacementExpression(node.property.name)) {
                    node.property = collector.getReplacementExpression(node.property.name) as any;
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

class MultiStringTrie {
    root: Map<string, TrieNode> = new Map();

    constructor(strings: string[]) {
        for (var s = 0; s < strings.length; s++) {
            const text = strings[s];
            for (var i = 0; i < text.length; i++) {
                var node = this.root;
                for (var j = i; j < text.length; j++) {
                    const char = text[j];
                    if (!node.has(char)) {
                        node.set(char, { children: new Map(), sourceIndices: new Set(), count: 0 });
                    }
                    const child = node.get(char)!;
                    child.sourceIndices.add(s);
                    child.count++;
                    node = child.children;
                }
            }
        }
    }

    extractAllSubstrings() {
        const substrings = new Map<string, number>();

        const traverse = (node: Map<string, TrieNode>, prefix: string) => {
            for (var [char, { children, count }] of node) {
                const newPrefix = prefix + char;
                // Frequency is how many original strings contain this substring
                substrings.set(newPrefix, count);
                traverse(children, newPrefix);
            }
        };

        traverse(this.root, "");
        return substrings;
    }
}

interface TrieNode {
    children: Map<string, TrieNode>;
    sourceIndices: Set<number>;
    count: number;
}

class StringTableCollector {
    seenStrings: string[] = [];
    /** original string -> replacement expression */
    expressions = new Map<string, t.Expression>();
    baseStrings = new Map<string, t.Identifier>();

    constructor(
        public minCount: number,
        public aggressiveMinLength: number,
        public aggressiveBenefitThreshold: number,
        public aggressiveSplitting: boolean,
    ) { }

    add(string: string) {
        this.seenStrings.push(string);
    }
    computeExpressions() {
        if (this.aggressiveSplitting) {
            this.aggressiveCompress();
        } else {
            this.simpleCompress();
        }
    }
    simpleCompress() {
        // Original behavior: each string gets its own variable
        const counts = new Set(this.seenStrings).values().map(s => [s, this.seenStrings.reduce((a, s2) => a + +(s === s2), 0)] as const).toArray();
        for (var [s, count] of counts) {
            if (count >= this.minCount) {
                const varName = toVarName(this.seenStrings.indexOf(s), s);
                this.expressions.set(s, t.identifier(varName));
                this.baseStrings.set(s, t.identifier(varName));
            }
        }
    }

    aggressiveCompress() {
        // Filter strings that will be replaced
        const stringsToCompress = this.seenStrings.slice();
        if (stringsToCompress.length === 0) return;

        // Initialize representations (each string is a single part initially)
        const representations = stringsToCompress.map(s => [s]);

        // Initialize base string variables
        for (var i = 0; i < stringsToCompress.length; i++) {
            const varName = toVarName(i, stringsToCompress[i]);
            this.expressions.set(stringsToCompress[i], t.identifier(varName));
            this.baseStrings.set(stringsToCompress[i], t.identifier(varName));
        }

        // Find all candidate substrings
        // Greedy extraction loop
        for (var iterationCount = 0; iterationCount < 10000; iterationCount++) { // Safety limit to prevent infinite loops
            const candidates = new MultiStringTrie(representations.flatMap(x => x)).extractAllSubstrings();
            if (candidates.size < 1) break;

            // Score candidates and find the best
            var bestSubstring: string | null = null;
            var bestBenefit = this.aggressiveBenefitThreshold;

            for (var [substring, frequency] of candidates) {
                if (frequency < 2) continue; // No benefit if appears only once
                if (substring.length < this.aggressiveMinLength) continue;

                // Current cost: bytes used by this substring across all occurrences
                const currentCost = frequency * substring.length;
                // New cost: variable name + storing the substring value
                const newCost = 1 + substring.length;
                const benefit = currentCost - newCost;

                if (benefit > bestBenefit) {
                    bestBenefit = benefit;
                    bestSubstring = substring;
                }
            }

            if (!bestSubstring) break; // No more beneficial extractions

            // Replace all occurrences in representations
            for (var i = 0; i < representations.length; i++) {
                const text = representations[i].join("");
                const parts: string[] = [];
                var lastIdx = 0;
                var idx = 0;

                while ((idx = text.indexOf(bestSubstring, lastIdx)) > -1) {
                    if (idx > lastIdx) {
                        parts.push(text.slice(lastIdx, idx));
                    }
                    parts.push(bestSubstring); // Reference to variable
                    lastIdx = idx + bestSubstring.length;
                }

                if (lastIdx < text.length) {
                    parts.push(text.slice(lastIdx));
                }

                representations[i] = parts;
            }
        }

        // Build Babel expressions from final representations
        for (var i = 0; i < stringsToCompress.length; i++) {
            const originalString = stringsToCompress[i];
            const parts = representations[i];
            const expr = this.buildExpressionFromParts(parts);
            this.expressions.set(originalString, expr);
            if (!t.isIdentifier(expr)) {
                this.baseStrings.delete(originalString);
            }
        }
    }

    buildExpressionFromParts(parts: string[]) {
        if (parts.length === 0) {
            return t.stringLiteral("");
        }

        return parts.slice(1).reduce((prev: t.Expression, part: string) => {
            return t.binaryExpression("+", prev, this.partToExpression(part))
        }, this.partToExpression(parts[0]));

    }

    partToExpression(part: string) {
        return this.expressions.getOrInsertComputed(part, () => {
            var name: string, res: t.Identifier;
            if (!this.seenStrings.includes(part)) {
                name = toVarName(this.seenStrings.push(part) - 1, part);
                res = t.identifier(name);
                this.baseStrings.set(part, res);
            } else {
                name = toVarName(this.seenStrings.indexOf(part), part);
                res = t.identifier(name);
            }
            return res;
        });
    }
    getReplacementExpression(string: string): t.Expression | undefined {
        // If aggressiveSplitting was used, return the built expression
        if (this.expressions.has(string)) {
            return this.expressions.get(string);
        }
    }

    getAllVars() {
        const declarators: t.VariableDeclarator[] = [];

        // Add all base strings (both from simple and aggressive compression)
        for (var [substring, varName] of this.baseStrings) {
            declarators.push(t.variableDeclarator(varName, t.stringLiteral(substring)));
        }

        return t.variableDeclaration("var", declarators);
    }
}

function toVarName(i: number, str: string): string {
    if (i < 0) throw Error("i < 0");
    return "__string" + i + "_" + (str
        .slice(0, 30)
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/^([0-9])/, "_$1")) + "_" + Math.random().toString(36).slice(2, 10);
}
