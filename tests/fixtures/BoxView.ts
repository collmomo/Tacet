import {live} from "../../src";

export class BoxView {
    @live public label = "hello";
    @live public shown = false;
    public box: HTMLDivElement | null = null;
    public boxWrites = 0;

    public setLabel(label: string): void { this.label = label; }
    public show(): void { this.shown = true; }
}
