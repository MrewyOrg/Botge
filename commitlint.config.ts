import { RuleConfigSeverity, type UserConfig } from '@commitlint/types';

const userConfig: Readonly<UserConfig> = {
  extends: ['@commitlint/config-conventional'],
  formatter: '@commitlint/format',
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
