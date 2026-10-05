import traverse from "@babel/traverse";
import * as t from "@babel/types";
import { BabelRewriter } from ".";
import { zish } from "../../utils";

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
    return (ast, verbose) => {
        if (verbose) console.log("starting stringDedupe");
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

        if (verbose) console.log("found", new Set(collector.seenStrings).size, "unique strings");
        collector.computeExpressions(verbose);

        // second pass: replace the strings
        if (verbose) console.log("Replacing strings with expressions");
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
                if (t.isIdentifier(node.key) && node.key.name.length > minPropLength) {
                    const expr = collector.getReplacementExpression(node.key.name);
                    if (expr) {
                        node.key = expr as any;
                        node.computed = true as false; // STUPID
                    }
                } else if (t.isStringLiteral(node.key) && node.key.value.length > minPropLength) {
                    const expr = collector.getReplacementExpression(node.key.value);
                    if (expr) {
                        node.key = expr as any;
                        node.computed = true as false; // STUPID
                    }
                }
            },
            MemberExpression(path) {
                if (!alsoDoProps) return;
                const node = path.node;
                if (node.computed) return;
                if (t.isIdentifier(node.property) && node.property.name.length > minPropLength) {
                    const expr = collector.getReplacementExpression(node.property.name);
                    if (expr) {
                        node.property = expr as any;
                        node.computed = true as false; // STUPID
                    }
                }
            }
        });

        // third: insert variables
        if (verbose) console.log("Inserting variables");
        const vars = collector.getAllVars();
        if (vars.declarations.length) ast.program.body.splice(0, 0, vars as any);

        if (verbose) console.log("finished stringDedupe");
        return ast;
    }
}

type Part = [isLit: boolean, text: string];

const ref = (text: string): Part => [false, text];
const lit = (text: string): Part => [true, text];

/** Merge adjacent literal parts and drop empty literals. */
function mergeParts(parts: Part[]): Part[] {
    const out: Part[] = [];
    for (var part of parts) {
        if (part[0]) {
            if (part[1].length === 0) continue;
            const last = out[out.length - 1];
            if (last?.[0]) last[1] += part[1];
            else out.push(lit(part[1]));
        } else {
            out.push(ref(part[1]));
        }
    }
    return out;
}

/** Count non-overlapping occurrences of `needle` in `haystack`, left to right. */
function countOccurrences(haystack: string, needle: string): number {
    if (needle.length === 0) return 0;
    var count = 0;
    var idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) > -1) {
        count++;
        idx += needle.length;
    }
    return count;
}

/** Split one literal chunk on every (non-overlapping) occurrence of `needle`. */
function splitLiteral(text: string, needle: string): Part[] {
    const parts: Part[] = [];
    var lastIdx = 0;
    var idx = 0;
    while ((idx = text.indexOf(needle, lastIdx)) > -1) {
        if (idx > lastIdx) parts.push(lit(text.slice(lastIdx, idx)));
        parts.push(ref(needle));
        lastIdx = idx + needle.length;
    }
    if (lastIdx < text.length) parts.push(lit(text.slice(lastIdx)));
    return parts;
}

/**
 * Safety cap for candidate enumeration: enumerating every substring of a
 * chunk is quadratic in the chunk length, so absurdly long literals (embedded
 * data blobs and the like) only contribute substrings up to this length.
 * Anything repeated at a longer scale contains repeated substrings well
 * under the cap, so this does not meaningfully limit real deduping.
 */
const MAX_SUBSTRING_LENGTH = 512;

/**
 * The assumed size of one variable reference for all benefit/cost
 * estimates in this pass. See expressionCost().
 */
const REFERENCE_COST = 3;

class StringTableCollector {
    seenStrings: string[] = [];
    /** How many times each distinct string was seen in the source. */
    counts = new Map<string, number>();
    /** string -> how it is built out of literal chunks and variable references */
    representations = new Map<string, Part[]>();
    /** Strings that own a variable in the output. */
    varStrings = new Set<string>();
    /** string -> name of its output variable */
    varNames = new Map<string, string>();
    nextVarIndex = 0;
    /** varStrings in dependency (Kahn) order: every variable after all the variables it references. */
    orderedVars: string[] = [];

    constructor(
        public minCount: number,
        public aggressiveMinLength: number,
        public aggressiveBenefitThreshold: number,
        public aggressiveSplitting: boolean,
    ) { }

    add(string: string) {
        this.seenStrings.push(string);
    }

    computeExpressions(verbose: boolean) {
        for (var s of this.seenStrings) {
            this.counts.set(s, (this.counts.get(s) ?? 0) + 1);
            if (!this.representations.has(s)) {
                this.representations.set(s, [lit(s)]);
            }
        }
        if (this.aggressiveSplitting) {
            this.aggressiveCompress(verbose);
        } else {
            this.simpleCompress(verbose);
        }
        this.finalizeVars(verbose);
    }

    makeVar(string: string) {
        if (this.varStrings.has(string)) return;
        this.varStrings.add(string);
        this.varNames.set(string, toVarName(this.nextVarIndex++, string));
        if (!this.representations.has(string)) {
            this.representations.set(string, [lit(string)]);
        }
    }

    simpleCompress(verbose: boolean) {
        var n = 0;
        for (var [s, count] of this.counts) {
            if (count >= this.minCount && s.length > 0) {
                this.makeVar(s);
                n++;
            }
        }
        if (verbose) console.log("found", n, "strings that occurred more than", this.minCount, "times to be replaced");
    }

    /**
     * How many times the representation of `owner` is materialized in the
     * output. A variable's definition is emitted exactly once; a string
     * without a variable is inlined at every use site, so its parts are
     * emitted once per occurrence in the source.
     */
    ownerWeight(owner: string): number {
        if (this.varStrings.has(owner)) return 1;
        return this.counts.get(owner) ?? 1;
    }

    aggressiveCompress(verbose: boolean) {
        if (this.counts.size === 0) return;

        // Whole strings first, under the same minCount rule as simple mode:
        // a string seen fewer than minCount times gets NO variable of its own.
        // (It can still be *built* out of other strings' variables at its use
        // sites -- see getReplacementExpression -- but it is never a variable
        // itself unless its total uses, standalone plus embedded, reach
        // minCount in the extraction loop below.)
        for (var [s, count] of this.counts) {
            if (count >= this.minCount && s.length > 0) this.makeVar(s);
        }

        const maxRounds = 1000; // safety limit; each round must apply >= 1 extraction and literal text only shrinks
        for (var round = 0; round < maxRounds; round++) {
            const candidates = this.collectCandidates();
            if (candidates.size === 0) break;

            // Viability at this stage uses the enumeration counts
            // (overlapping occurrences, like the old trie's counts). Exact
            // counts are recomputed per candidate just before it is applied,
            // and finalizeVars() enforces minCount exactly on the final
            // graph, so an optimistic count here can never leak an
            // under-used variable into the output.
            const viable: { text: string; benefit: number }[] = [];
            for (var [text, estimated] of candidates) {
                const refs = estimated + (this.varStrings.has(text) ? 0 : (this.counts.get(text) ?? 0));
                const benefit = this.benefit(text, refs);
                if (benefit !== null) viable.push({ text, benefit });
            }
            if (viable.length === 0) break;
            // Deterministic order: most benefit first, then longest, then lexicographic.
            viable.sort((a, b) =>
                b.benefit - a.benefit ||
                b.text.length - a.text.length ||
                (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

            // Where each viable candidate occurred at the start of this
            // round, so applying one only touches the representations that
            // can contain it instead of rescanning everything per candidate.
            // Occurrences inside variables created *during* this round are
            // not in this map; the next round picks those up.
            const owners = this.collectOwners(new Set(viable.map(v => v.text)));

            var appliedAny = false;
            for (var { text } of viable) {
                const where = owners.get(text);
                if (!where) continue;
                // An earlier candidate in this round may have eaten this
                // one's occurrences: recount exactly, but only there.
                const embedded = this.countRemaining(text, where);
                const refs = embedded + (this.varStrings.has(text) ? 0 : (this.counts.get(text) ?? 0));
                if (embedded < 1 || this.benefit(text, refs) === null) continue;
                this.applyCandidate(text, where);
                appliedAny = true;
            }
            if (verbose) console.log("aggressive splitting round", round);
            if (!appliedAny) break; // nothing changed -- further rounds would find the same candidates
        }
    }

    /** Visit every substring of `text` that could become a candidate: at least aggressiveMinLength long, at most MAX_SUBSTRING_LENGTH, and never cutting a surrogate pair in half. */
    scanSubstrings(text: string, visit: (sub: string) => void) {
        const maxLen = Math.min(text.length, MAX_SUBSTRING_LENGTH);
        for (var i = 0; i + this.aggressiveMinLength <= text.length; i++) {
            // Never start a candidate in the middle of a surrogate pair.
            const firstCode = text.charCodeAt(i);
            if (firstCode >= 0xdc00 && firstCode <= 0xdfff) continue;
            var sub = "";
            for (var j = i; j < text.length && j - i < maxLen; j++) {
                sub += text[j];
                if (sub.length < this.aggressiveMinLength) continue;
                // Never end a candidate in the middle of a surrogate pair.
                const lastCode = sub.charCodeAt(sub.length - 1);
                if (lastCode >= 0xd800 && lastCode <= 0xdbff) continue;
                visit(sub);
            }
        }
    }

    /**
     * Every substring of every remaining literal chunk, mapped to a rough
     * (overlapping, occurrence-weighted) count. Substrings are never
     * recorded if they are as long as the string that contains them: a
     * variable may only reference strictly shorter strings.
     */
    collectCandidates(): Map<string, number> {
        const candidates = new Map<string, number>();
        for (var [owner, parts] of this.representations) {
            const weight = this.ownerWeight(owner);
            for (var part of parts) {
                if (!part[0]) continue;
                this.scanSubstrings(part[1], sub => {
                    if (sub.length < owner.length) {
                        candidates.set(sub, (candidates.get(sub) ?? 0) + weight);
                    }
                });
            }
        }
        return candidates;
    }

    /** For each wanted substring, the set of strings whose representation contained it (as literal text) when this was called. */
    collectOwners(wanted: Set<string>): Map<string, Set<string>> {
        const owners = new Map<string, Set<string>>();
        for (var [owner, parts] of this.representations) {
            for (var part of parts) {
                if (!part[0]) continue;
                this.scanSubstrings(part[1], sub => {
                    if (sub.length >= owner.length || !wanted.has(sub)) return;
                    var set = owners.get(sub);
                    if (!set) owners.set(sub, (set = new Set()));
                    set.add(owner);
                });
            }
        }
        return owners;
    }

    /**
     * The benefit of extracting `text`, given `refs` total references to it,
     * or null if that is not worth doing.
     *
     * Benefit heuristic:
     * bytes currently spent spelling the substring out, minus the one-off
     * cost of storing it -- except that a variable that already exists has
     * already paid that cost. A not-yet-variable string must also reach
     * minCount total references: its standalone uses count towards `refs`,
     * which is how a string that is rare on its own but common as a
     * substring can still earn a variable, and why one that stays under
     * minCount in total never does.
     */
    benefit(text: string, refs: number): number | null {
        const isVar = this.varStrings.has(text);
        const benefit = refs * text.length - (isVar ? 0 : text.length + REFERENCE_COST);
        if (benefit <= this.aggressiveBenefitThreshold) return null;
        if (!isVar && refs < this.minCount) return null;
        return benefit;
    }

    /** Exact (non-overlapping, weighted) occurrences of `text` in the literal chunks of `owners`, as they are right now. */
    countRemaining(text: string, owners: Set<string>): number {
        var embedded = 0;
        for (var owner of owners) {
            if (owner === text) continue; // a string never counts as a use of itself
            if (text.length >= owner.length) continue; // strictly-longer owners only to help avoid creating cycles
            const parts = this.representations.get(owner);
            if (!parts) continue;
            const weight = this.ownerWeight(owner);
            for (var part of parts) {
                if (part[0]) embedded += weight * countOccurrences(part[1], text);
            }
        }
        return embedded;
    }

    /**
     * Give `text` a variable (if it doesn't have one) and rewrite the
     * literal chunks it occurs in -- including the representations of
     * other variables, which is what makes the output variables
     * themselves come out split.
     */
    applyCandidate(text: string, owners: Set<string>) {
        this.makeVar(text);
        for (var owner of owners) {
            if (owner === text) continue; // never reference yourself
            if (text.length >= owner.length) continue; // strictly-shorter rule (cycle protection)
            const parts = this.representations.get(owner);
            if (!parts) continue;
            var changed = false;
            const out: Part[] = [];
            for (var part of parts) {
                if (!part[0] || !part[1].includes(text)) {
                    out.push(part);
                    continue;
                }
                changed = true;
                out.push(...splitLiteral(part[1], text));
            }
            if (changed) this.representations.set(owner, mergeParts(out));
        }
    }

    /**
     * Replace every reference to `victim`'s variable with the literal text
     * and delete the variable. Used to prune variables that end up used
     * fewer than minCount times, and to break reference cycles if one ever
     * forms. If `victim` is an original string it keeps its (split)
     * representation -- its use sites are then inlined instead.
     */
    inlineVar(victim: string) {
        this.varStrings.delete(victim);
        this.varNames.delete(victim);
        for (var [owner, parts] of this.representations) {
            if (owner === victim) continue;
            if (!parts.some(p => !p[0] && p[1] === victim)) continue;
            this.representations.set(owner, mergeParts(
                parts.flatMap(p => (!p[0] && p[1] === victim) ? [lit(victim)] : [p]),
            ));
        }
        if (!this.counts.has(victim)) this.representations.delete(victim);
    }

    /** Total references to each variable in the final output: standalone uses plus references from representations, weighted as in ownerWeight(). */
    finalRefCounts(): Map<string, number> {
        const refs = new Map<string, number>();
        for (var v of this.varStrings) refs.set(v, this.counts.get(v) ?? 0);
        for (var [owner, parts] of this.representations) {
            const weight = this.ownerWeight(owner);
            for (var part of parts) {
                if (!part[0] && refs.has(part[1])) {
                    refs.set(part[1], refs.get(part[1])! + weight);
                }
            }
        }
        return refs;
    }

    /**
     * Approximate size of the expression built from `parts`, for deciding
     * whether inlining a split pays for itself. References are priced at
     * REFERENCE_COST, not at their generated name length: the generated
     * names are deliberately long and descriptive (and carry a random
     * suffix against collisions), on the assumption that a later
     * minification pass renames them -- the same assumption the benefit
     * heuristic in benefit() has always made.
     */
    expressionCost(parts: Part[]): number {
        const merged = mergeParts(parts);
        var cost = Math.max(0, merged.length - 1); // the "+"s
        for (var part of merged) {
            cost += part[0]
                ? part[1].length + 2 // quotes
                : REFERENCE_COST;
        }
        return cost;
    }

    /**
     * Settle the variable set and its declaration order:
     *  1. A string without a variable whose split expression would not be
     *     shorter than its literal reverts to the literal -- its references
     *     must not be counted as uses of the variables it pointed at.
     *  2. Any variable whose total final uses fell below minCount (possible
     *     after overlaps were consumed, or after step 1 removed uses) is
     *     inlined away; that can cascade, so counts are recomputed.
     *  3. Variables are ordered with Kahn's algorithm so every variable is
     *     declared after all the variables its definition references.
     * Steps 1-3 repeat until nothing changes: inlining in step 2 or breaking
     * a cycle in step 3 can reopen steps 1-2.
     */
    finalizeVars(verbose: boolean) {
        // Defensive: no variable's definition may reference itself, not even
        // indirectly through a part that spells the string out again.
        for (var v of [...this.varStrings]) {
            const parts = this.representations.get(v);
            if (parts?.some(p => !p[0] && p[1] === v)) {
                this.representations.set(v, mergeParts(
                    parts.flatMap(p => (!p[0] && p[1] === v) ? [lit(v)] : [p]),
                ));
            }
        }

        const maxGuards = this.varStrings.size + this.counts.size + 2;
        for (var guard = 0; guard < maxGuards; guard++) {
            var changed = false;

            if (this.aggressiveSplitting) {
                for (var s of this.counts.keys()) {
                    if (this.varStrings.has(s)) continue;
                    const parts = this.representations.get(s);
                    if (!parts?.some(p => !p[0])) continue;
                    if (this.expressionCost(parts) >= s.length + 2) {
                        this.representations.set(s, [lit(s)]);
                        changed = true;
                    }
                }
            }

            // Prune under-used variables (lowest use count first, deterministic).
            while (true) {
                const refs = this.finalRefCounts();
                const underused = [...this.varStrings]
                    .filter(v => (refs.get(v) ?? 0) < this.minCount)
                    .sort((a, b) => (refs.get(a)! - refs.get(b)!) || (a < b ? -1 : 1));
                if (underused.length === 0) break;
                this.inlineVar(underused[0]);
                changed = true;
            }

            const { order, cycleVictim } = this.kahnOrder();
            if (cycleVictim !== null) {
                // Should be unreachable: references always point at strictly
                // shorter strings, so the graph is a DAG by length. If a
                // future change breaks that invariant, break the cycle by
                // inlining one of its variables rather than emitting
                // declarations that reference each other (or themselves).
                this.inlineVar(cycleVictim);
                if (verbose) console.log("found cycle in variable dependency graph");
                changed = true;
                continue;
            }
            this.orderedVars = order;
            if (!changed) break;
        }
        // Guard exhausted (also unreachable in practice): fall back to
        // whatever acyclic prefix Kahn produced rather than nothing.
        this.orderedVars = this.kahnOrder().order;
    }

    /**
     * Kahn's algorithm over the variable reference graph: an edge D -> V
     * means "V's definition references D", so D must be declared first.
     * If there's a tie, we don't care about the order.
     * If some variables are never freed they form (or depend on) a cycle;
     * one of them is reported so the caller can inline it and retry.
     */
    kahnOrder(): { order: string[]; cycleVictim: string | null } {
        const creationOrder = new Map([...this.varStrings].map((v, i) => [v, i] as const));
        const remainingDeps = new Map<string, number>();
        const dependents = new Map<string, string[]>();
        for (var v of this.varStrings) {
            const deps = new Set<string>();
            for (var part of this.representations.get(v) ?? []) {
                if (!part[0] && part[1] !== v && this.varStrings.has(part[1])) {
                    deps.add(part[1]);
                }
            }
            remainingDeps.set(v, deps.size);
            for (var d of deps) {
                const list = dependents.get(d) ?? [];
                list.push(v);
                dependents.set(d, list);
            }
        }
        const ready = [...this.varStrings]
            .filter(v => remainingDeps.get(v) === 0)
            .sort((a, b) => creationOrder.get(a)! - creationOrder.get(b)!);
        const order: string[] = [];
        while (ready.length > 0) {
            const v = ready.shift()!;
            order.push(v);
            for (var dependent of dependents.get(v) ?? []) {
                const left = remainingDeps.get(dependent)! - 1;
                remainingDeps.set(dependent, left);
                if (left === 0) {
                    // Insert keeping creation order, for stable output.
                    const at = ready.findIndex(x => creationOrder.get(x)! > creationOrder.get(dependent)!);
                    if (at === -1) ready.push(dependent);
                    else ready.splice(at, 0, dependent);
                }
            }
        }
        if (order.length === this.varStrings.size) return { order, cycleVictim: null };
        const inCycle = [...this.varStrings]
            .filter(v => !order.includes(v))
            .sort((a, b) => creationOrder.get(a)! - creationOrder.get(b)!);
        return { order, cycleVictim: inCycle[0] ?? null };
    }

    buildExpressionFromParts(parts: Part[]): t.Expression {
        const merged = mergeParts(parts);
        if (merged.length === 0) return t.stringLiteral("");
        const toExpr = (part: Part): t.Expression =>
            part[0]
                ? t.stringLiteral(part[1])
                : t.identifier(this.varNames.get(part[1])!);
        return merged.slice(1).reduce<t.Expression>(
            (prev, part) => t.binaryExpression("+", prev, toExpr(part)),
            toExpr(merged[0]),
        );
    }

    getReplacementExpression(string: string): t.Expression | undefined {
        if (this.varStrings.has(string)) {
            return t.identifier(this.varNames.get(string)!);
        }
        if (!this.aggressiveSplitting) return undefined;
        const parts = this.representations.get(string);
        if (!parts?.some(p => !p[0])) return undefined;
        // A string without a variable is inlined at its use sites, so only
        // replace it if the concatenation is actually shorter than the
        // literal. finalizeVars() has already reverted the ones that are
        // not; this re-check keeps the two from drifting apart.
        if (this.expressionCost(parts) >= string.length + 2) return undefined;
        return this.buildExpressionFromParts(parts);
    }

    getAllVars() {
        const declarators: t.VariableDeclarator[] = [];
        // In Kahn order, and each initializer is the variable's own split
        // representation -- not a plain literal -- so variables are built
        // out of the (shorter) variables declared before them.
        for (var v of this.orderedVars) {
            const parts = this.representations.get(v) ?? [lit(v)];
            declarators.push(t.variableDeclarator(
                t.identifier(this.varNames.get(v)!),
                this.buildExpressionFromParts(parts),
            ));
        }
        return t.variableDeclaration("var", declarators);
    }
}

function toVarName(i: number, str: string): string {
    if (i < 0) throw Error("i < 0");
    return "__string" + i + str.replace(/[^a-zA-Z0-9_]/g, "_") + zish();
}
