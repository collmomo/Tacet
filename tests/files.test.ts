import {describe, expect, it} from "vitest";
import {mount} from "@vue/test-utils";
import {nextTick} from "vue";
import {rewriteTacetFile} from "../src/files";
import Box from "./fixtures/Box.tacet";
import {BoxView} from "./fixtures/BoxView";

// `box` stays a plain field, as the check asks, so a proxy counts the writes into it.
function countBoxWrites(view: BoxView): BoxView {
    return new Proxy(view, {set: (target, key, value) => { if (key === "box") target.boxWrites++; return Reflect.set(target, key, value); }});
}

describe("a .tacet file, rewritten", () => {
    it("adds setup to the script and turns ref into a call on the view's field", () => {
        const result = rewriteTacetFile(`<template>\n  <div ref="view.box"></div>\n  <canvas ref='view.manager.canvas'></canvas>\n  <p ref="plain"></p>\n</template>\n<script lang="ts">\nimport {V} from "./V";\nconst view = new V();\n</script>`, "/a.tacet");
        expect(result?.code).toBe(`<template>\n  <div :ref="__tacetRef(view, 'box')"></div>\n  <canvas :ref='__tacetRef(view.manager, "canvas")'></canvas>\n  <p ref="plain"></p>\n</template>\n<script setup lang="ts">\nimport {assignElement as __tacetRef} from "tacet/runtime";\n\nimport {V} from "./V";\nconst view = new V();\n</script>`);
    });

    it("leaves a script that already has setup, and a file with nothing to do", () => {
        expect(rewriteTacetFile(`<template><p ref="x"></p></template>\n<script setup>\nconst a = 1;\n</script>`, "/a.tacet")).toBeNull();
        const result = rewriteTacetFile(`<template><p ref="view.x"></p></template>\n<script setup>\nconst view = {};\n</script>`, "/a.tacet");
        expect(result?.code).toContain(`<script setup>\nimport {assignElement as __tacetRef} from "tacet/runtime";`);
    });

    it("warns when a ref names a view but there is no script", () => {
        const result = rewriteTacetFile(`<template><p ref="view.x"></p></template>`, "/a.tacet");
        expect(result?.warnings).toEqual([`/a.tacet: ref="view.box" needs a <script> block that holds \`view\`.`]);
    });
});

describe("a .tacet component, mounted", () => {
    it("reads the view, follows its marks and hands the element to the field", async () => {
        const view = new BoxView();
        const wrapper = mount(Box, {props: {view}});
        expect(wrapper.find(".box").text()).toBe("hello");
        expect(view.box).toBe(wrapper.find(".box").element);
        expect(wrapper.find(".shown").exists()).toBe(false);

        view.setLabel("bye");
        await nextTick();
        expect(wrapper.find(".box").text()).toBe("bye");

        await wrapper.find("button").trigger("click");
        expect(wrapper.find(".shown").exists()).toBe(true);
        expect(view.box).toBe(wrapper.find(".box").element);

        wrapper.unmount();
        expect(view.box).toBeNull();
    });

    it("writes the element only when it differs: once on mount, once on unmount", async () => {
        const view = new BoxView();
        const wrapper = mount(Box, {props: {view: countBoxWrites(view)}});
        expect(view.box).toBe(wrapper.find(".box").element);
        expect(view.boxWrites).toBe(1);

        await wrapper.find("button").trigger("click");
        expect(wrapper.find(".shown").exists()).toBe(true);
        expect(view.boxWrites).toBe(1);

        view.setLabel("bye");
        await nextTick();
        expect(wrapper.find(".box").text()).toBe("bye");
        expect(view.boxWrites).toBe(1);

        wrapper.unmount();
        expect(view.box).toBeNull();
        expect(view.boxWrites).toBe(2);
    });
});
