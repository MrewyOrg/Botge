import { RuleConfigSeverity, type UserConfig } from '@commitlint/types';

/** Dependabot signs off every commit it writes; nobody else uses this identity. */
const DEPENDABOT_SIGN_OFF = /^Signed-off-by: dependabot\[bot\] <support@github\.com>$/mu;

const userConfig: Readonly<UserConfig> = {
  extends: ['@commitlint/config-conventional'],
  formatter: '@commitlint/format',
  // Dependabot writes its own messages. Lines naming long dependencies or commit hashes without a
  // link exceed the length rules, and Dependabot cannot be told to wrap them.
  ignores: [(message: string): boolean => DEPENDABOT_SIGN_OFF.test(message)],
  rules: {
    'scope-empty': [RuleConfigSeverity.Error, 'never'],
    'scope-case': [RuleConfigSeverity.Error, 'always', 'kebab-case'],
    'header-trim': [RuleConfigSeverity.Error, 'always'],
    'header-max-length': [RuleConfigSeverity.Error, 'always', 100],
    'subject-min-length': [RuleConfigSeverity.Error, 'always', 3],
    'body-leading-blank': [RuleConfigSeverity.Error, 'always'],
    'body-max-line-length': [RuleConfigSeverity.Error, 'always', 100],
    'footer-leading-blank': [RuleConfigSeverity.Error, 'always'],
    'footer-max-line-length': [RuleConfigSeverity.Error, 'always', 100]
  },
  helpUrl:
    'https://github.com/conventional-changelog/commitlint/blob/master/%40commitlint/config-conventional/README.md'
};

export default userConfig;
