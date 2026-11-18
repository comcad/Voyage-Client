# Contributing to Voyage Client

Thanks for wanting to help. Voyage Client has one goal: to behave **exactly like the original version 83 client**, down to timings, formulas, messages, positions and the odd details. Contributions are very welcome as long as they move it closer to that.

## Before you start

- **Read the code you're changing.** Much of what looks like a typo or a strange number (an `x + 30` where `y + 30` seems right, or a two-space gap in a message). "Fixing" these makes the client less faithful.
- **For anything big, ask first.** Open an issue or ask on Discord before starting a large change, so we can agree on it before you spend the time.

## Pull requests

- **One topic per pull request.** A fix to the trade window and a change to physics go in separate PRs. Small PRs get reviewed and merged quickly; large ones may not be reviewed at all.
- **Say what the original does, and how you know.** For any change to gameplay, packets, windows, text or timing, describe the original client's behaviour and your evidence: a screenshot or video of the original, a capture of its packets, the game data it reads, or another source we can check. A change that only makes the code "more reasonable" isn't a fix here.
- **Keep refactors apart from behaviour.** Renames, tidying and comment changes go in their own PR, and must not change what the client does.
- **Commit messages describe exactly what changed.** No claims of tests that weren't run, and no changes the message doesn't mention.
- **Each PR must work on its own.** It must build, start, log in and change maps without needing another open PR.
- **Test against [Voyage-Server](https://github.com/comcad/Voyage-Server).** Anything that changes what the client sends must still work with the server's handlers and scripts.

Large batches of generated or automated changes will be closed, even when some parts are good. The good parts are easier to take as small, separate PRs.

## Game assets

Never add game assets (images, sounds, music, maps or other data extracted from the game) to the repository. Voyage Client reads assets that each user supplies; see the README's disclaimer.

## Licence

By contributing, you agree that your code is released under the repository's [MIT licence](LICENSE.txt).
