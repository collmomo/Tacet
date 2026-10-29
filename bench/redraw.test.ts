/**
 * The redraw cost. A view holds a plain array of 1,000,000 slot objects in an
 * unmarked field and one @live count. Two templates: one reads the count, one
 * calls a method that walks the layout. Arm A: the Tacet view, raw. Arm B: the
 * same class with no mark, handed in as reactive(view), which is what Vue does
 * to anything in a store.
 *
 * Run: npm run bench   (BENCH=1, gc exposed, a 12 GB heap: the wrapped arm at a million slots needs about 5 GB)
 * A smaller run: BENCH_SLOTS=100000 npm run bench
 */
import {describe, expect, it} from "vitest";
import {createApp, defineComponent, h, nextTick, reactive, type Component} from "vue";
import {live} from "../src";

const SLOTS = Number(process.env.BENCH_SLOTS ?? 1_000_000);

interface Slot { row: number; col: number; width: number; }

function layout(): Slot[] {
    const slots: Slot[] = [];
    for (let i = 0; i < SLOTS; i++) slots.push({row: i % 1000, col: Math.floor(i / 1000), width: 10});
    return slots;
}

class TacetView {
    @live public count = 0;
    public layout = layout();
    public bump(): void { this.count++; }
    public widthSum(): number { let sum = 0; for (const slot of this.layout) sum += slot.width; return sum; }
}

class PlainView {
    public count = 0;
    public layout = layout();
    public bump(): void { this.count++; }
    public widthSum(): number { let sum = 0; for (const slot of this.layout) sum += slot.width; return sum; }
}

type View = TacetView | PlainView;

const countOnly = (view: View): Component => defineComponent({render: () => h("p", String(view.count))});
const walksLayout = (view: View): Component => defineComponent({render: () => h("p", `${view.count} ${view.widthSum()}`)});

function heap(): number {
    (globalThis as {gc?: () => void}).gc?.();
    return process.memoryUsage().heapUsed;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

async function measure(name: string, view: View, template: (view: View) => Component): Promise<{mount: number; redraw: number; heap: number; stray: number}> {
    const before = heap();
    const root = document.createElement("div");
    const start = performance.now();
    const app = createApp(template(view));
    app.mount(root);
    const mount = performance.now() - start;
    const after = heap();
    const redraws: number[] = [];
    for (let i = 0; i < 10; i++) {
        const t = performance.now();
        view.bump();
        await nextTick();
        redraws.push(performance.now() - t);
    }
    expect(root.textContent).toContain(String(view.count));
    // A write into the layout: does the screen redraw?
    const text = root.textContent;
    view.layout[0].width = 99;
    await nextTick();
    const stray = root.textContent !== text ? 1 : 0;
    app.unmount();
    const result = {mount, redraw: median(redraws), heap: (after - before) / 1_048_576, stray};
    console.log(`${name.padEnd(36)} mount ${result.mount.toFixed(1)} ms   one redraw ${result.redraw.toFixed(2)} ms   heap after mount ${result.heap >= 0 ? "+" : ""}${result.heap.toFixed(0)} MB   write into the layout redraws: ${stray ? "yes" : "no"}`);
    return result;
}

describe.skipIf(!process.env.BENCH)("the redraw cost", () => {
    it("reads the count: Tacet and reactive(view)", async () => {
        await measure("reads the count / Tacet", new TacetView(), countOnly);
        await measure("reads the count / reactive(view)", reactive(new PlainView()), countOnly);
    }, 120_000);

    it("walks the layout: Tacet and reactive(view)", async () => {
        const tacet = await measure("walks the layout / Tacet", new TacetView(), walksLayout);
        const wrapped = await measure("walks the layout / reactive(view)", reactive(new PlainView()), walksLayout);
        expect(tacet.stray).toBe(0);
        expect(wrapped.redraw).toBeGreaterThan(tacet.redraw);
    }, 300_000);
});
