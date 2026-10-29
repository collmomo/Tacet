import {live} from "tacet";

/** A thing to do. It marks what the screen follows on it: `@deep` on a list stops at the class. */
export class Todo {
    public readonly id: string;
    @live public text: string;
    @live public isDone = false;

    constructor(text: string, id: string = crypto.randomUUID()) {
        this.id = id;
        this.text = text;
    }

    public toggle(): void {
        this.isDone = !this.isDone;
    }
}
