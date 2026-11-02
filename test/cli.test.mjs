// Contract tests for the 117terminal command line (src/main/cli.js). Run: node --test test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import { parseArgs, completions, EXIT } from '../src/main/cli.js'

const home = os.homedir()

test('no arguments opens the app', () => {
  const o = parseArgs([], home)
  assert.equal(o.command, 'gui')
  assert.deepEqual(o.dirs, [])
})

test('help and version, long and short', () => {
  assert.equal(parseArgs(['--help']).command, 'help')
  assert.equal(parseArgs(['-h']).command, 'help')
  assert.equal(parseArgs(['help']).command, 'help')
  assert.equal(parseArgs(['--version']).command, 'version')
  assert.equal(parseArgs(['-v']).command, 'version')
})

test('unknown option fails with a suggestion', () => {
  assert.match(parseArgs(['--serv']).error, /unknown option: --serv \(did you mean --serve\?\)/)
  assert.match(parseArgs(['-x']).error, /unknown option: -x/)
})

test('typo in a subcommand suggests it', () => {
  assert.match(parseArgs(['doctr'], home).error, /did you mean doctor/)
})

test('folders resolve against the caller folder; missing ones fail', () => {
  assert.deepEqual(parseArgs(['.'], home).dirs, [home])
  assert.match(parseArgs(['/definitely/not/here'], home).error, /no such folder/)
  assert.equal(parseArgs(['open', '.'], home).command, 'gui')
})

test('serve validates the port and token options', () => {
  assert.equal(parseArgs(['serve', '--port', '8080']).port, 8080)
  assert.equal(parseArgs(['--serve', '--port=8080']).port, 8080)
  assert.match(parseArgs(['serve', '--port', 'abc']).error, /invalid --port/)
  assert.match(parseArgs(['serve', '--port', '70000']).error, /invalid --port/)
  assert.match(parseArgs(['serve', '--token', 'a', '--token-file', 'b']).error, /not both/)
  assert.match(parseArgs(['--port', '8080']).error, /only works with --serve/)
})

test('run and theme', () => {
  const r = parseArgs(['run', 'npm', 'test'], home)
  assert.equal(r.run, 'npm test')
  assert.equal(r.cwd, home)
  assert.match(parseArgs(['run']).error, /run needs a command/)
  assert.equal(parseArgs(['theme', 'ninja']).theme, 'ninja')
  assert.match(parseArgs(['theme', 'ninj']).error, /did you mean ninja/)
})

test('Chromium switches pass through', () => {
  const o = parseArgs(['--no-sandbox', '--ozone-platform=headless', '--enable-features=X'], home)
  assert.equal(o.error, undefined)
  assert.equal(o.passthrough.length, 3)
})

test('lenient mode ignores what Electron adds on a second launch', () => {
  const o = parseArgs(['--allow-file-access-from-files', '--original-process-start-time=1', '.'], home, { lenient: true })
  assert.equal(o.error, undefined)
  assert.deepEqual(o.dirs, [home])
})

test('completions exist for bash, zsh and fish', () => {
  for (const sh of ['bash', 'zsh', 'fish']) assert.match(completions(sh), /117terminal/)
  assert.match(parseArgs(['completions', 'tcsh']).error, /bash, zsh or fish/)
})

test('exit codes', () => {
  assert.deepEqual(EXIT, { OK: 0, ERROR: 1, USAGE: 2, PORT_IN_USE: 3 })
})
