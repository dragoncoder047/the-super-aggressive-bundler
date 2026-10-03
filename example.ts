
const sin = Math.sin, cos = Math.cos;

const a = sin(Math.random());
const b = cos(Math.random());

export function main(x: any) {
    console.log("flags1", x, inner(flags1));
    function inner(x: any[]) {
        x.forEach(i => i.length ? inner(i) : null);
        return x;
    }
}

export function canBeRewrittenAsArrow(a: any, b: any, c: any) {
    main(a);
    console.log(b, c, function (this: any) { return this.f instanceof c });
}

export function cannotBeRewrittenAsArrow1(this: any, a: any, b: any, c: any) {
    this.something(a);
    console.log(b, c, b instanceof c);
}
export function cannotBeRewrittenAsArrow2(this: any, a: any, b: any, c: any) {
    main(a);
    console.log(b, c, new RegExp(RegExp.escape("123") + "|" + RegExp.escape("123") + "|" + RegExp.escape("123") + "|" + RegExp.escape("123")), () => this.f);
}

export class TheClass {
    bar = 1;
}

enum Foo {
    bar, baz
}

// this should NOT be transformed
// @ts-expect-error
Foo.console.log(1);

export const x = { [Foo.bar]: 1, [Foo.baz]: 2, ["hi"]: 3 };

export const y = { longproperty1: 1, longproperty2: 2, longproperty3: 3 };

export const z = { "longproperty1": 1, "longproperty2": 2, "longproperty3": 3 };

export function myFunction(arg: typeof y) {
    console.log(arg instanceof TheClass);
    console.log(arg.longproperty1, arg.longproperty2 + arg.longproperty3);
}

await Promise.resolve();

export function functionThatReturnsDirectly(a: number, b: number, c: number) {
    return a + b * c;
}

export const str1 = String.raw`foo${a}bar${b}bam`;
export const str2 = `foo${a}bar${b}bam`;
export const flags1 = ["default", "default", "default", "default", "default", "default", "inherit", "default", "default", "inherit", "inherit", "inherit"];
export const flags2 = ["foo", "bar", "foo", "bam", "foo", "bar", "foo", "bam"];

console.log(function () {
    return { a: 1, b: 2, c: 3 }
});

console.log({
    name: "foo",
    args: ["bar", "baz", "bam"],
    // purposefully repetitive to demonstrate
    doc: `.desc This hook implements foo
    .param bar - required - 123 is special!
    .param baz - default value is whatever is inherited from [[bam]]
    .param bam - this hook inherits a lot`,
});
