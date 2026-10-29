import {live} from "../../src";

export const shared = {x: 1};

export class SharedView {
    @live public get x(): number { return shared.x; }
}
