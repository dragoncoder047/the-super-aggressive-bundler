import * as t from "@babel/types";

export class StringTableCollector {
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

function toPlusExpression(vars: string[]) {
    const varRefs = vars.map(v => t.identifier(v));
    return t.parenthesizedExpression((varRefs as any[]).reduce((prev, cur) => t.binaryExpression("+", prev, cur)));
}
