# Decisions

## Decided (the owner, 2026-10-29)

- Components are `.tacet` files: template, script, style, compiled by Vue's compiler (one `include` option, one tsconfig line, one editor line).
- Kept from Vue: the template syntax, props (a parent hands a component its view or object), the lifecycle hooks (`onMounted` and its family).
- Gone: `ref`, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`.
- The marks are `@live` (shallow, compares before writing) and `@deep`. No base class, no call to make things live.
- Written for TypeScript with the owner's conventions; plain JavaScript works through the comment tags.

## Open

1. **One surface: decorators or comment tags.** My pick is the comment tags: the same in TS and JS, no flag, no Babel version, nothing tied to a proposal that moved back to Stage 2.7 in May 2026 (RESEARCH.md).
2. **Arrays and maps under `@live`.** `push`, `set` and `splice` are silent; only a new array or map notifies. Either the rule is "replace it", or such a field must be `@deep`.
3. **Cached getters.** Caching every getter is a bug: a getter that reads a plain field goes stale (tested). Choose: no cache (always right, re-runs per read), or a third mark for the getters worth caching.
4. **A class loaded with no build.** Tags: plain fields, the screen never updates, no error. Decorators: `SyntaxError`. Decide whether the silent case needs a check (for example, the mount warns when a view has no marked field).
5. **One mark makes a whole object raw.** An entity with one `@live` field is no longer seen into by a `@deep` list that holds it: its unmarked fields stop updating the screen (tested). The rule has to say so, or the mark must not make the object raw.
6. **An unmarked class inside `@deep` is walked**, big fields included: the grouping lag's shape. Keep this as "`@deep` means everything inside", or stop `@deep` at any class instance.
7. **The getter on each instance or on the prototype.** On each instance, making an object costs 1.1 µs per marked field, against 0.08 µs on the prototype. A few views do not care; entities made by the thousand do. The tag plugin can write the prototype form; a decorator needs the `accessor` keyword for it.
8. **May a template write a `@live` field?** The README's `@input="view.draft = $event.target.value"` writes one. Either that is allowed, or every write goes through a method (`view.setDraft(...)`), which is what the chat model's tool list calls.
9. **`<script>` or `<script setup>` in a `.tacet` file.** Vue gives the template a file's top-level names only from `<script setup>`. The README's `<script lang="ts">` needs `setup`, or the plugin adds it.
10. **Vue 3.5 or 3.6.** 3.6 brings the new reactivity and Vapor, but is a release candidate (rc.13, 2026-10-23). The prototype runs on both.
11. **The tag plugin's parser.** TypeScript (already installed with `vue-tsc`, 575 ms to load per build) or a lighter one (Babel's or oxc's parser).
12. **A mistyped tag.** `/** @lvie */` is silently plain. Decide whether the plugin warns on an `@` tag on a field that is close to `live` or `deep`.
13. **Devtools.** Not tried. Open a Tacet view in the Vue devtools in a browser before promising it works there.
