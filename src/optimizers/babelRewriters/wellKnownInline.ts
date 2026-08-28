import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";

export interface WellKnownInlineOptions {
    names?: string[];
}

/**
 * Replaces all references to common builtin namespaces such as `Math`, `JSON`, `Reflect`, etc. with
 * destructuring of that namespace into variables.
 */
export function wellKnownInline(options: WellKnownInlineOptions = {}): BabelRewriter {
    const names = options.names ?? ["Math", "JSON", "Reflect", "Object", "Array", "Symbol", "Promise", "Proxy", "Error", "console"];
    return ast => {

        const mangleMap = new Map<`${string}.${string}`, string>();
        const seen = new Set<t.MemberExpression>();
        const mangle = (ns: string, id: string, node: NodePath<any>) => {
            return mangleMap.getOrInsertComputed(`${ns}.${id}`, () => {
                const s = `__${ns}_${id}_${Math.random().toString(36).slice(2, 10)}`;
                const memberExpression = t.memberExpression(t.identifier(ns), t.identifier(id));
                seen.add(memberExpression);
                (node.findParent(p => p.isProgram()) as any as NodePath<t.Program>).unshiftContainer("body", t.variableDeclaration("var", [t.variableDeclarator(t.identifier(s), memberExpression)]));
                return s;
            });
        }
        for (var name of names) {
            traverse(ast, {
                MemberExpression(path) {
                    if (seen.has(path.node)) return;
                    const { object, property } = path.node;
                    if (t.isIdentifier(object) && t.isIdentifier(property) && name === object.name && !path.scope.getBinding(object.name)) {
                        path.replaceWith(t.identifier(mangle(object.name, property.name, path)));
                    }
                }
            });
        }

        return ast;
    }
}
