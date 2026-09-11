import { it, expect } from 'vitest'
import { PrefsStore, defaultPrefs } from './prefs'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

it('quarantines corrupt prefs and reseeds defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-prefs-'))
  fs.writeFileSync(path.join(dir, 'prefs.json'), '{not json')
  const store = new PrefsStore(dir)
  const p = store.load()
  expect(p).toEqual(defaultPrefs())
  expect(fs.readdirSync(dir).some((f) => f.startsWith('prefs.json.corrupt-'))).toBe(true)
  expect(store.load().version).toBe(1)
})
