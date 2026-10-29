# Decisions

## Decided (the owner, 2026-10-29)

- Components are `.tacet` files: template, script, style, compiled by Vue's compiler (one `include` option, one tsconfig line, one editor line).
- Kept from Vue: the template syntax, props (a parent hands a component its view or object), the lifecycle hooks (`onMounted` and its family).
- Gone: `ref`, `reactive`, `computed`, `watch`, `watchEffect`, `provide`, `inject`, stores, `emit`.
- The marks are `@live` (shallow, compares before writing) and `@deep`. No base class, no call to make things live.
- Written for TypeScript with the owner's conventions; plain JavaScript works through the comment tags.
- A getter is cached only when marked `@live`: it follows what it reads and keeps its result until one of them changes. An unmarked getter is a plain getter. Methods never need a mark. (A `@live` getter must read only marked fields: one that reads a plain field keeps its old value, tested.)
- A DOM element reaches a view through `ref="view.box"` on a plain field: the `.tacet` build assigns the element on mount and `null` on unmount, writing only when it differs; no method form (the owner, 2026-10-29); something to do on arrival is the component's `onMounted`.

- A template never writes a field: a change goes through a method of the view (`view.typeDraft(...)`), the same method a test or a tool would call (the README's todo app does so).

- The marks are DECORATORS, `@live` and `@deep`, as the README shows them: the `.tacet` build compiles them (TypeScript 5's standard decorators, no flag) so nothing waits on the browsers. The comment tag `/** @live */` is the same mark spelled for plain JavaScript, one runtime under both (the owner, 2026-10-29).

- `@live` tracks assignment, `@deep` tracks mutation: a push under `@live` tells no one; under `@deep` it does (the owner, 2026-10-30).
- A `@live` getter may read only marked fields, checked by the build hop by hop through the types (`this.a.b.c`: a mark on each hop's class, or a plain object under a `@deep` field); a plain or unknowable hop is a BUILD ERROR naming the hop, never a stale value (the owner, 2026-10-30: "compilation problems seem like a good idea").
- `@deep` stops at a class instance: it walks plain objects and arrays, never enters a class; a class's surface is its own marks only, so one mark never changes another field's behaviour (the owner, 2026-10-30).
- A `@live` getter that reads an unmarked field keeping its old value "by design" is withdrawn: it is the build error above.

- A class with no marks at all (a library's: a Date, a DateRange, a chart) is a VALUE: it is held in a marked field and replaced when it changes; a path into it ends at that field (a leaf for the getter check); its own mutations tell no one. A library's plain containers (Map, Set, array) under `@deep` are tracked like plain data. A library object that changes itself (a socket, a chart instance) lives in a plain field and the view copies what the screen needs into marked fields when it calls back (the owner, 2026-10-30).

## Open

1. **A class loaded with no build.** Tags: plain fields, the screen never updates, no error. Decorators: `SyntaxError`. Decide whether the silent case needs a check (for example, the mount warns when a view has no marked field).
2. **The getter on each instance or on the prototype.** On each instance, making an object costs 1.1 µs per marked field, against 0.08 µs on the prototype. A few views do not care; entities made by the thousand do. The tag plugin can write the prototype form; a decorator needs the `accessor` keyword for it.
3. **`<script>` or `<script setup>` in a `.tacet` file.** Vue gives the template a file's top-level names only from `<script setup>`. The README's `<script lang="ts">` needs `setup`, or the plugin adds it.
4. **Vue 3.5 or 3.6.** 3.6 brings the new reactivity and Vapor, but is a release candidate (rc.13, 2026-10-23). The prototype runs on both.
5. **The tag plugin's parser.** TypeScript (already installed with `vue-tsc`, 575 ms to load per build) or a lighter one (Babel's or oxc's parser).
6. **A mistyped tag.** `/** @lvie */` is silently plain. Decide whether the plugin warns on an `@` tag on a field that is close to `live` or `deep`.
7. **Devtools.** Not tried. Open a Tacet view in the Vue devtools in a browser before promising it works there.
