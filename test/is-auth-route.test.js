// @vitest-environment node
if (!process.env.VITEST) {
  console.log('[skip] is-auth-route.test.js requires vitest runtime')
} else {
  const { describe, expect, it } = await import('vitest')
  const { isAuthRoutePath } = await import('../lib/is-auth-route.js')

  describe('isAuthRoutePath', () => {
    it('matches /auth/* and legacy login/register', () => {
      expect(isAuthRoutePath('/auth/login/')).toBe(true)
      expect(isAuthRoutePath('/auth/register/?x=1')).toBe(true)
      expect(isAuthRoutePath('/login/')).toBe(true)
      expect(isAuthRoutePath('/register')).toBe(true)
      expect(isAuthRoutePath('/reset-password/')).toBe(true)
    })
    it('rejects app surfaces', () => {
      expect(isAuthRoutePath('/system-admin/users/')).toBe(false)
      expect(isAuthRoutePath('/tenant/1/work-panel/')).toBe(false)
      expect(isAuthRoutePath('/')).toBe(false)
    })
  })
}
