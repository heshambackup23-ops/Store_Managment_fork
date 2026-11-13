import { z } from 'zod';
import { walletProviderAliases } from '../../shared/payment-channel';

type WalletProvider = keyof typeof walletProviderAliases;
export const walletProviderFilter = z.enum(Object.keys(walletProviderAliases) as [WalletProvider, ...WalletProvider[]]).optional();

export function walletProviderScope(provider: WalletProvider | undefined, column: 'provider' | 'w.provider') {
  const values = provider ? [...walletProviderAliases[provider]] : [];
  const clause = values.length ? `LOWER(TRIM(${column})) IN (${values.map(() => '?').join(', ')})` : '';
  return { clause, values };
}
