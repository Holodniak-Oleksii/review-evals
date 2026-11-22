const SECRET_KEY =
  /^(INPUT_|ACTIONS_|ANTHROPIC_)|^(GITHUB_TOKEN|GH_TOKEN|GITHUB_PAT|CLAUDE_CODE_OAUTH_TOKEN)$/i;

export function commandEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !SECRET_KEY.test(key)) env[key] = value;
  }
  return {
    ...env,
    CI: 'true',
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    pnpm_config_verify_deps_before_run: 'false',
  };
}
