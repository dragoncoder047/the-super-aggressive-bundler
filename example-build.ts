import {
    arrowFunctionRewrite,
    babelRewrite,
    bunMinify,
    classRewrite,
    hoistAllFunctions,
    inlineConstantComputedKeys,
    instanceofRewrite,
    pipelineBuild,
    stringDedupe,
    typeofRewrite,
    wellKnownInline,
} from ".";

var original!: number, transformed!: number;

await pipelineBuild(
    {
        entrypoints: ["./example.ts"],
        minify: !process.argv.includes("--no-minify"),
        verbose: true,
    },
    [
        async (source, sourcemap) => {
            original = source.length;
            return [source, sourcemap];
        },
        babelRewrite(
            inlineConstantComputedKeys(),
            stringDedupe({ minimumRepeat: 1 }),
            instanceofRewrite(),
            typeofRewrite(),
            arrowFunctionRewrite(),
            wellKnownInline(),
            classRewrite(),
            hoistAllFunctions(),
        ),
        ...(process.argv.includes("--no-minify") ? [] : [bunMinify()]),
        async (source, sourcemap) => {
            transformed = source.length;
            return [source, sourcemap];
        },
    ],
);

console.log("Original:", original, "bytes");
console.log("Transformed:", transformed, "bytes");
console.log(
    "That's a saving of",
    original - transformed,
    "bytes or",
    Math.round((100 * (original - transformed)) / original) +
        "% over the original",
);
