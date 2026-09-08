export type EnvTheme = 'telepathy' | 'sansara' | 'iktara' | 'nudge'
export type ColorTheme = 'light' | 'dark'

/** Program accents and the existing light/dark preference are independent. */
export function setEnvTheme(env: EnvTheme = 'telepathy', theme?: ColorTheme) {
  document.documentElement.dataset.env = env
  if (theme) document.documentElement.dataset.theme = theme
}
