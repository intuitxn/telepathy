// Optional Desk compatibility: use the installed OpenCode CLI and its normal config.
export const cliPath = () => process.env.OPENCODE_BIN || 'opencode';
export function runtimeEnv() {
  const env = { ...process.env };
  delete env.BUZZ_PRIVATE_KEY;
  delete env.BUZZ_AUTH_TAG;
  // This is environment hygiene, not filesystem/keychain isolation.
  return env;
}
