# Agent quality checks

Settings, Design guide controls the four required steps. The last guide layer containing `## Required steps` supplies the whole list; an empty list disables all steps. File overrides live in `<file>.fold/guide.md`.

Before `write_html` into a new artboard without tokens, call `oc_post_brief` with `fileId`, optional `artboardId`, `mood`, `palette`, `type` and `direction`. Omit the artboard id to cover the whole file. Briefs persist in `document.json` and appear in the Agent tab. Files with tokens bypass the brief gate. The gate returns a soft tool error and does not modify the document.

After five writes without a screenshot of the affected artboard, the review step appends the existing checkpoint reminder. A screenshot resets it. Literal colours and sizes equal to existing tokens produce a warning naming the equivalent variable. More than 60 layers in one `write_html` produces a small-step warning. Warnings do not undo successful writes. Tool descriptions repeat the essential brief, token, small-step and review rules.

## Fixed prompt review

`tests/quality/prompts.json` fixes four prompts: a landing page, railway dashboard, mobile seed-library app and astronomy poster. Use the exact prompt, guide revision, agent model and settings for comparisons. Run each prompt through a connected agent, save the resulting `.fold` file, then record it:

```sh
pnpm exec tsx tests/quality/record.ts landing /tmp/output/Landing.fold
```

Replace `landing` with `dashboard`, `mobile` or `poster`. The script uses hidden Chromium, an isolated temporary `OPENCREASE_HOME`, the real screenshot tool and the file's artboards. It records screenshots, prompt, timestamp and document under `test-results/quality/<run>/<prompt>/`. It does not invoke a model or fabricate outputs. Keep the model name, model settings, app commit and guide revision alongside the run when reviewing a release.

Compare type hierarchy, spacing, contrast, alignment, clipping, repetition and realistic content at the intended artboard size. A human reviewer must prefer the new results before a guide change ships. CI can archive `test-results/quality`; a model/provider is deliberately not a test dependency.

## Automated checks

`pnpm test` covers policy parsing and toggles, the actual brief gate, literal-token warnings, diff, schema, WebMCP registration, authentication, origins, permissions, history and sanitisation. `pnpm test:visual` compares all fixture pixels and exported PNGs. `pnpm exec tsx tests/platform-live.ts` exercises the real editor on server 29910 and Vite 5210, records an axe audit and saves screenshots in `test-results/track10`. It stops every process it starts and removes its temporary configuration and workspace.
