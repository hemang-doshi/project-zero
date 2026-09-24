import playwright from '../assets/skill-brands/playwright.svg?url'
import superpowers from '../assets/skill-brands/superpowers.svg?url'

export type VerifiedSkillBrand = {
  id: string
  name: string
  src: string
  alt: string
  source: string
  commit: string
  license: 'Apache-2.0' | 'MIT'
}

// IDs are exact plugin/package identities from Skills Lab discovery. Unknown
// families stay unbranded until an official asset and its provenance exist.
const VERIFIED_SKILL_BRANDS: Readonly<Record<string, VerifiedSkillBrand>> = {
  playwright: {
    id: 'playwright',
    name: 'Playwright',
    src: playwright,
    alt: 'Playwright official logo',
    source: 'https://github.com/microsoft/playwright/blob/6ee9e8820f7e322b473a672e9ad0d11dc8690a02/packages/dashboard/public/playwright-logo.svg',
    commit: '6ee9e8820f7e322b473a672e9ad0d11dc8690a02',
    license: 'Apache-2.0'
  },
  superpowers: {
    id: 'superpowers',
    name: 'Superpowers',
    src: superpowers,
    alt: 'Superpowers official plugin icon',
    source: 'https://github.com/obra/superpowers/blob/5bf4e78011075bcfc0dc295f0724994cd123ee71/assets/superpowers-small.svg',
    commit: '5bf4e78011075bcfc0dc295f0724994cd123ee71',
    license: 'MIT'
  }
}

export function verifiedSkillBrand(pluginId: string): VerifiedSkillBrand | null {
  return VERIFIED_SKILL_BRANDS[pluginId] ?? null
}
