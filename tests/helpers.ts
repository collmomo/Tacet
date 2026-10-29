import {effect} from "vue";

/** Runs `read` inside a Vue effect and counts how many times it ran. */
export function follow(read: () => unknown): {runs: number; last: unknown; stop: () => void} {
    const state = {runs: 0, last: undefined as unknown, stop: () => {}};
    const runner = effect(() => {
        state.runs++;
        state.last = read();
    });
    state.stop = () => runner.effect.stop();
    return state;
}
