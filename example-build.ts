import { arrowFunctionRewrite, arrowFunctionSingle, babelRewrite, bunMinify, classRewrite, hoistAllFunctions, inlineConstantComputedKeys, instanceofRewrite, pipelineBuild, stringDedupe, wellKnownInline } from ".";

var original!: number, transformed!: number;

await pipelineBuild({
    entrypoints: ["./example.ts"],
    minify: false,
    verbose: true,
}, [
    async (source, sourcemap) => { original = source.length; return [source, sourcemap]; },
    babelRewrite(
        inlineConstantComputedKeys(),
        stringDedupe({ minimumRepeat: 1 }),
        instanceofRewrite(),
        arrowFunctionRewrite(),
        arrowFunctionSingle(),
        wellKnownInline(),
        classRewrite(),
        hoistAllFunctions()),
    bunMinify(),
    async (source, sourcemap) => { transformed = source.length; return [source, sourcemap]; },
]);

console.log("Original:", original, "bytes");
console.log("Transformed:", transformed, "bytes");
console.log("That's a saving of", original - transformed, "bytes or", Math.round(100 * (original - transformed) / original) + "% over the original");
