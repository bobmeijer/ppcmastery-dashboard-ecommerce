import dashboardConfig, { type AccountConfig, type ModuleKey, type OptionalPage } from '../../dashboard.config';
import { DEMO_MODE } from './demoMode';
import { moduleGate, type ModuleSwitches } from './modules';

// The rest of the app reads dashboard.config.ts through this file.
export const config = dashboardConfig;
export const { brand: BRAND, currency: CURRENCY, locale: LOCALE, timeZone: TIME_ZONE } = dashboardConfig;

export const ACCOUNTS: AccountConfig[] = dashboardConfig.accounts;
export const DEFAULT_SCOPE = ACCOUNTS[0].label;

export const isAccountLabel = (value: string | null | undefined): value is string => ACCOUNTS.some(a => a.label === value);
export const accountConfig = (label: string | null | undefined) => ACCOUNTS.find(a => a.label === label);
export const accountName = (label: string) => accountConfig(label)?.name ?? label;
export const accountHidesPage = (label: string, page: OptionalPage) => accountConfig(label)?.hiddenPages?.includes(page) ?? false;

// The demo shows every module, whatever the switches say.
const SWITCHES: ModuleSwitches = DEMO_MODE
  ? Object.fromEntries(Object.keys(dashboardConfig.modules).map(key => [key, true])) as ModuleSwitches
  : dashboardConfig.modules;
export const moduleEnabled = (key: ModuleKey) => SWITCHES[key];
export const requestGate = (pathname: string, search: URLSearchParams) => moduleGate(pathname, search, SWITCHES, DEMO_MODE);
