v1.0.1 - 2019-02-06
-----------------------

- doc fixes
  * note we work on truffle 5.0.0 or greater
  * note --debug=2 option
  * truffle-analyze -> truffle-security
- fix recent versions of truffle mangling bytecode
- fix bux introduced in 1.0.0 to filter migrations
- severity levels have been lowered over 1.0.0

v1.0.0 - 2019-02-04
-----------------------

- Name change: change the package name and git repo from `truffle-analyze` to
  `truffle-security` and the invocation changes from `truffle run analyze` to
  `truffle run verify`
- We new support a trial user when no credentials are
  given. (Requires armlet 1.2.0 or greater)
- Better error messaging, especially on timeouts
- new option `--uuid` to look at results of previous runs.
  This is pretty basic right now -- beefing up may require
  work in conjunction with changes on the backend.
- `--debug` will show the UUID in play. `--debug=1` (or greater) will
  show the JSON MythX responses
- remove extraneous fields in analysis request
- default analysis mode is "quick"
- Update docs
