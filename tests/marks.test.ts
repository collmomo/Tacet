import {describe, expect, it} from "vitest";
import ts from "typescript";
import {findScriptOpening, promoteScriptToSetup, readDecoratorMark, readMark, readMarkName, readTagMark} from "../src/marks";

describe("the shared helpers", () => {
    it("promotes the script tag before the content, and finds the tag", () => {
        const source = `<template></template>\n<script lang="ts">\nconst a = 1;\n</script>`;
        const content = source.indexOf("\nconst a");
        expect(promoteScriptToSetup(source, content)).toBe(`<template></template>\n<script setup lang="ts">\nconst a = 1;\n</script>`);
        expect(findScriptOpening(`<template></template><script lang="ts">x</script>`, 40)).toBe(21);
        expect(findScriptOpening("no tag", 3)).toBe(-1);
    });

    it("knows the two marks and nothing else", () => {
        expect(readMarkName("live")).toBe("live");
        expect(readMarkName("deep")).toBe("deep");
        expect(readMarkName("lvie")).toBeUndefined();
    });
});

describe("the mark readers", () => {
    const members = (code: string): ts.ClassElement[] => {
        const file = ts.createSourceFile("m.ts", code, ts.ScriptTarget.Latest, true);
        return (file.statements[0] as ts.ClassDeclaration).members.slice();
    };
    it("reads a decorator, plain or called, a tag, and lets the decorator win", () => {
        const [decorated, called, tagged, both, plain] = members(`class V {\n @live a = 1;\n @deep() b = [];\n /** @live */ c = 1;\n /** @deep */ @live d = 1;\n e = 1;\n}`);
        expect(readDecoratorMark(decorated)).toBe("live");
        expect(readDecoratorMark(called)).toBe("deep");
        expect(readDecoratorMark(tagged)).toBeUndefined();
        expect(readTagMark(tagged)).toBe("live");
        expect(readTagMark(decorated)).toBeUndefined();
        expect(readMark(both)).toBe("live");
        expect(readMark(plain)).toBeUndefined();
    });
});
