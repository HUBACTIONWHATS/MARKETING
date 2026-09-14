/**
 * Contexto do "shell" (menu lateral/topo) por requisição, sem passar parâmetro
 * por todas as páginas: um middleware em /empresa/:companyId calcula o que o
 * usuário pode ver (mídia paga) e o estado de cada provedor (Meta/Google) e
 * guarda num AsyncLocalStorage; appShell lê daí. Só apresentação — a
 * autorização real continua nos middlewares de rota (auth.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { ConnectionStatus, MarketingProvider } from "./marketingModels";

export type ProviderNavStatus = "CONECTADO" | "NAO_CONECTADO" | "RECONEXAO";

export interface ShellContext {
  canViewMarketing: boolean;
  isPlatformAdmin: boolean;
  providers: Record<MarketingProvider, ProviderNavStatus>;
}

export const PROVIDER_NAV_LABEL: Record<ProviderNavStatus, string> = {
  CONECTADO: "Conectado",
  NAO_CONECTADO: "Não conectado",
  RECONEXAO: "Reconexão necessária",
};

const storage = new AsyncLocalStorage<ShellContext>();

export function runWithShell<T>(ctx: ShellContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentShell(): ShellContext | undefined {
  return storage.getStore();
}

/** Estado de cada provedor a partir das contas vinculadas à empresa (nunca a partir da sessão OAuth global). */
export function providerNavStatuses(accounts: { provider: MarketingProvider; connection_status: ConnectionStatus }[]): Record<MarketingProvider, ProviderNavStatus> {
  const status = (p: MarketingProvider): ProviderNavStatus => {
    const mine = accounts.filter((a) => a.provider === p);
    if (mine.length === 0) return "NAO_CONECTADO";
    return mine.some((a) => a.connection_status === "CONECTADA") ? "CONECTADO" : "RECONEXAO";
  };
  return { META: status("META"), GOOGLE: status("GOOGLE") };
}
