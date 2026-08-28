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
    const names = options.names ?? ["Math", "JSON", "Reflect", "Object", "Array", "String", "Symbol", "Promise", "Proxy", "Error", "RegExp", "console"];
    return ast => {

        const mangleMemberMap = new Map<`${string}.${string}`, string>();
        const mangleIdentifierMap = new Map<string, string>();
        const seenMember = new Set<t.MemberExpression>();
        const seenIdentifier = new Set<t.Identifier>();
        const mangleMember = (ns: string, id: string, node: NodePath<any>) => {
            return mangleMemberMap.getOrInsertComputed(`${ns}.${id}`, () => {
                const s = `__${ns}_${id}_${Math.random().toString(36).slice(2, 10)}`;
                const memberExpression = t.memberExpression(t.identifier(ns), t.identifier(id));
                seenMember.add(memberExpression);
                (node.findParent(p => p.isProgram()) as any as NodePath<t.Program>).unshiftContainer("body", t.variableDeclaration("var", [t.variableDeclarator(t.identifier(s), memberExpression)]));
                return s;
            });
        };
        const mangleBareIdentifier = (id: string, node: NodePath<any>) => {
            return mangleIdentifierMap.getOrInsertComputed(id, () => {
                const s = `__${id}_${Math.random().toString(36).slice(2, 10)}`;
                const realId = t.identifier(id);
                seenIdentifier.add(realId);
                (node.findParent(p => p.isProgram()) as any as NodePath<t.Program>).unshiftContainer("body", t.variableDeclaration("var", [t.variableDeclarator(t.identifier(s), realId)]));
                return s;
            });
        };
        for (var name of names) {
            var memberCount = 0, directCount = 0;
            traverse(ast, {
                MemberExpression(path) {
                    if (seenMember.has(path.node)) return;
                    const { scope, node: { object, property } } = path;
                    if (t.isIdentifier(object) && t.isIdentifier(property) && name === object.name && !scope.getBinding(object.name)) {
                        if (memberCount++ > 1) path.stop();
                    }
                }
            });
            if (memberCount > 1) {
                traverse(ast, {
                    MemberExpression(path) {
                        if (seenMember.has(path.node)) return;
                        const { scope, node: { object, property } } = path;
                        if (t.isIdentifier(object) && t.isIdentifier(property) && name === object.name && !scope.getBinding(object.name)) {
                            path.replaceWith(t.identifier(mangleMember(object.name, property.name, path)));
                        }
                    }
                });
            }
            traverse(ast, {
                Identifier(path) {
                    const { parent, node, scope } = path;
                    if (seenIdentifier.has(node)) return;
                    if ((t.isCallExpression(parent) || t.isNewExpression(parent) || (t.isMemberExpression(parent) && parent.property !== node)) && node.name === name && !scope.getBinding(node.name)) {
                        if (directCount++ > 1) path.stop();
                    }
                },
            });
            if (directCount > 1) {
                traverse(ast, {
                    Identifier(path) {
                        const { parent, node, scope } = path;
                        if (seenIdentifier.has(node)) return;
                        if ((t.isCallExpression(parent) || t.isNewExpression(parent) || (t.isMemberExpression(parent) && parent.property !== node)) && node.name === name && !scope.getBinding(node.name)) {
                            path.replaceWith(t.identifier(mangleBareIdentifier(node.name, path)));
                        }
                    },
                });
            }
        }

        return ast;
    }
}
