import { describe, expect, it } from 'vitest'
import { verifiedSkillBrand } from './skillBrands'

describe('verified skill brand assets', () => {
  it('maps exact discovered package identities to bundled official assets', () => {
    expect(verifiedSkillBrand('playwright')).toMatchObject({
      id: 'playwright',
      name: 'Playwright',
      alt: 'Playwright official logo',
      license: 'Apache-2.0',
      commit: '6ee9e8820f7e322b473a672e9ad0d11dc8690a02'
    })
    expect(verifiedSkillBrand('superpowers')).toMatchObject({
      id: 'superpowers',
      name: 'Superpowers',
      alt: 'Superpowers official plugin icon',
      license: 'MIT',
      commit: '5bf4e78011075bcfc0dc295f0724994cd123ee71'
    })
    expect(verifiedSkillBrand('playwright')?.src).not.toMatch(/^https?:/)
    expect(verifiedSkillBrand('superpowers')?.src).not.toMatch(/^https?:/)
  })

  it.each(['gstack', '.system', 'standalone', 'Playwright', 'unknown']) (
    'returns no invented mark for unverified identity %s',
    (id) => expect(verifiedSkillBrand(id)).toBeNull()
  )
})
