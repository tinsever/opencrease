# Contributing to OpenCrease

OpenCrease is a clean-room implementation built from public documentation and independently observed public interfaces. Before submitting a contribution, confirm:

- You wrote the change yourself or have permission to submit it under the licence of the affected package.
- You did not copy proprietary implementation code, artwork, fonts, icons or UI copy from another design tool.
- You have not used private source code to implement the corresponding feature. If you have seen private source for that area, do not contribute to it.
- Public interface names and argument shapes may be implemented for interoperability. Cite the public documentation when it informed a change.
- Preserve third-party licences and notices. The shader library is Apache-2.0; its notices remain in `THIRD_PARTY_NOTICES`.

By submitting a contribution, you attest that these clean-room conditions apply to it. Include this attestation in your pull request description:

> I confirm this contribution was independently implemented from public sources and contains no proprietary code or assets.

## Developer Certificate of Origin

Every contribution must carry a DCO sign-off. Read the [Developer Certificate of Origin 1.1](https://developercertificate.org/) and add `Signed-off-by: Your Name <your@email.example>` to each commit with `git commit -s`. Use an identity you are entitled to sign for. A sign-off certifies your right to contribute; it does not transfer copyright.

## Development checks

Run `pnpm install`, `pnpm typecheck` and `pnpm test`. Changes to rendering also run `pnpm test:visual`; inspect generated images in `test-results/visual`. The standalone platform check is `pnpm exec tsx tests/platform-live.ts` and requires the track test ports 29910 and 5210 to be free.

Tests must use a temporary `OPENCREASE_HOME` and a temporary workspace. Never write test state to the user's real `~/.opencrease`, open visible windows or terminate processes you did not start.

The apps are licensed under AGPL-3.0-or-later (root `LICENSE`). `@opencrease/format`, `@opencrease/model`, `@opencrease/css` and `@opencrease/protocol` are MIT-licensed. Contributions are accepted under the licence of the package they change.
