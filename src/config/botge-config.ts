import type { BotgeConfig } from '../types.ts';
import { loadConfig } from './load-config.ts';

export const botgeConfig: BotgeConfig = loadConfig();
