const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:8787";

function resolveGatewayBaseUrl(rawValue: string | undefined): string {
  const trimmed = rawValue?.trim() ?? "";

  if (!trimmed || trimmed.startsWith("/")) {
    return DEFAULT_GATEWAY_BASE_URL;
  }

  const normalized = trimmed.replace(/\/+$/, "");

  if (!normalized) {
    return DEFAULT_GATEWAY_BASE_URL;
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(normalized)) {
    return normalized;
  }

  return `http://${normalized}`;
}

export const gatewayBaseUrl = resolveGatewayBaseUrl(process.env.NEXT_PUBLIC_GATEWAY_URL);

export const discoveryLinks = {
  health: `${gatewayBaseUrl}/health`,
  manifest: `${gatewayBaseUrl}/api/v1/discovery/manifest`,
  contracts: `${gatewayBaseUrl}/api/v1/discovery/contracts`,
  agentTools: `${gatewayBaseUrl}/api/v1/discovery/agent-tools`,
  operations: `${gatewayBaseUrl}/api/v1/discovery/operations`,
  proofs: `${gatewayBaseUrl}/api/v1/discovery/proofs?limit=12`,
  openapi: `${gatewayBaseUrl}/api/v1/discovery/openapi.json`,
} as const;

export const bazaarLinks = {
  docs: "https://docs.cdp.coinbase.com/x402/bazaar",
  testnetDiscovery: "https://x402.org/facilitator/discovery/resources",
  cdpDiscovery: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources",
  cdpMerchantTemplate: "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=<address>",
} as const;

export type FetchState<T> = {
  data: T | null;
  error: string | null;
};

export type DiscoveryOperation = {
  id: string;
  contractId: string;
  providerId?: string;
  sellerId?: string;
  beneficiaryAddress?: string;
  functionName: string;
  method: "GET" | "POST";
  path: string;
  paymentRequired: boolean;
  priceStroops: number;
  payment: {
    challengeRequired: boolean;
    minAmountStroops: number;
    payToAddress: string;
    networkPassphrase: string;
    providerId?: string;
    sellerId?: string;
    beneficiaryAddress?: string;
  };
};

export type DiscoveryContract = {
  contractId: string;
  providerId?: string;
  sellerId?: string;
  beneficiaryAddress?: string;
  contractExplorerUrl?: string;
  paidOperations: number;
  freeOperations: number;
  minPriceStroops: number;
  maxPriceStroops: number;
  operations: Array<{
    id: string;
    functionName: string;
    method: "GET" | "POST";
    path: string;
    paymentRequired: boolean;
    priceStroops: number;
  }>;
};

export type DiscoveryProof = {
  file: string;
  generatedAt: number;
  paymentChallengeStatus: number | null;
  invokeHttpStatus: number | null;
  txHash: string | null;
  proofTxExplorerUrl?: string;
};

export type Manifest = {
  network: string;
  generatedAt: number;
  paymentDefaults: {
    payToAddress: string;
    networkPassphrase: string;
    challengeTtlSeconds: number;
  };
  summary: {
    contracts: number;
    operations: number;
    paidOperations: number;
    freeOperations: number;
  };
  contracts: DiscoveryContract[];
  operations: DiscoveryOperation[];
  proof: {
    availableProofs: number;
    latestProof?: {
      file: string;
      generatedAt: number;
      paymentChallengeStatus: number | null;
      invokeHttpStatus: number | null;
      txHash: string | null;
      proofTxExplorerUrl?: string;
    };
  };
};

export type HealthResponse = {
  status?: string;
  ok?: boolean;
  network?: string;
};

export type DiscoveryOperationsResponse = {
  network: string;
  generatedAt: number;
  operations: DiscoveryOperation[];
};

export type DiscoveryContractsResponse = {
  network: string;
  generatedAt: number;
  contracts: DiscoveryContract[];
};

export type DiscoveryProofsResponse = {
  network: string;
  generatedAt: number;
  availableProofs: number;
  proofs: DiscoveryProof[];
};

export type RankedOperation = DiscoveryOperation & {
  score: number;
};

export type RankedContract = DiscoveryContract & {
  score: number;
};

export type GatewaySnapshot = {
  network: string;
  generatedAt: number;
  health: FetchState<HealthResponse>;
  manifest: FetchState<Manifest>;
  operations: FetchState<DiscoveryOperationsResponse>;
  contracts: FetchState<DiscoveryContractsResponse>;
  proofs: FetchState<DiscoveryProofsResponse>;
  inlineErrors: string[];
};

async function fetchJson<T>(url: string): Promise<FetchState<T>> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      return { data: null, error: `${response.status} ${response.statusText}` };
    }

    return { data: (await response.json()) as T, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "request failed",
    };
  }
}

export async function fetchManifest(): Promise<FetchState<Manifest>> {
  return fetchJson<Manifest>(discoveryLinks.manifest);
}

export async function fetchHealth(): Promise<FetchState<HealthResponse>> {
  return fetchJson<HealthResponse>(discoveryLinks.health);
}

export async function fetchOperations(): Promise<FetchState<DiscoveryOperationsResponse>> {
  return fetchJson<DiscoveryOperationsResponse>(discoveryLinks.operations);
}

export async function fetchContracts(): Promise<FetchState<DiscoveryContractsResponse>> {
  return fetchJson<DiscoveryContractsResponse>(discoveryLinks.contracts);
}

export async function fetchProofs(): Promise<FetchState<DiscoveryProofsResponse>> {
  return fetchJson<DiscoveryProofsResponse>(discoveryLinks.proofs);
}

export async function fetchGatewaySnapshot(): Promise<GatewaySnapshot> {
  const [health, manifest, operations, contracts, proofs] = await Promise.all([
    fetchHealth(),
    fetchManifest(),
    fetchOperations(),
    fetchContracts(),
    fetchProofs(),
  ]);

  const network =
    manifest.data?.network ??
    operations.data?.network ??
    contracts.data?.network ??
    proofs.data?.network ??
    health.data?.network ??
    "unknown";

  const generatedAt = Math.max(
    manifest.data?.generatedAt ?? 0,
    operations.data?.generatedAt ?? 0,
    contracts.data?.generatedAt ?? 0,
    proofs.data?.generatedAt ?? 0,
  );

  const inlineErrors = [
    health.error ? `health: ${health.error}` : null,
    manifest.error ? `manifest: ${manifest.error}` : null,
    operations.error ? `operations: ${operations.error}` : null,
    contracts.error ? `contracts: ${contracts.error}` : null,
    proofs.error ? `proofs: ${proofs.error}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    network,
    generatedAt,
    health,
    manifest,
    operations,
    contracts,
    proofs,
    inlineErrors,
  };
}

function proofMentionsOperation(proof: DiscoveryProof, operation: DiscoveryOperation): boolean {
  const file = proof.file.toLowerCase();
  return (
    file.includes(operation.functionName.toLowerCase()) ||
    file.includes(operation.contractId.slice(-8).toLowerCase()) ||
    file.includes(operation.id.slice(-8).toLowerCase())
  );
}

export function getTrendingOperations(
  operations: readonly DiscoveryOperation[],
  proofs: readonly DiscoveryProof[],
  limit = 6,
): RankedOperation[] {
  return [...operations]
    .map((operation) => {
      const proofHits = proofs.filter((proof) => proofMentionsOperation(proof, operation)).length;
      const score =
        proofHits * 10 +
        (operation.paymentRequired ? 5 : 2) +
        Math.min(operation.priceStroops / 10000, 12);

      return {
        ...operation,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function getTopEarningOperations(
  operations: readonly DiscoveryOperation[],
  limit = 6,
): RankedOperation[] {
  return [...operations]
    .map((operation) => ({
      ...operation,
      score: operation.paymentRequired ? operation.priceStroops : 0,
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function getRecentlyActiveContracts(
  contracts: readonly DiscoveryContract[],
  proofs: readonly DiscoveryProof[],
  limit = 6,
): RankedContract[] {
  return [...contracts]
    .map((contract) => {
      const proofHits = proofs.filter((proof) =>
        proof.file.toLowerCase().includes(contract.contractId.slice(-8).toLowerCase()),
      ).length;
      const score =
        proofHits * 12 +
        contract.paidOperations * 3 +
        contract.operations.length +
        contract.maxPriceStroops / 10000;

      return {
        ...contract,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function formatGeneratedAt(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "-";
  }

  return new Date(milliseconds).toLocaleString();
}

export function shorten(value: string, keep = 8): string {
  if (value.length <= keep * 2 + 3) {
    return value;
  }

  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

export function formatStroops(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  const xlm = value / 10_000_000;
  return `${value.toLocaleString()} stroops (${xlm.toFixed(7)} xlm)`;
}
