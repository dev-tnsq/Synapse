#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';

const registerOptionsSchema = z.object({
  gateway: z.string().url(),
  contractId: z.string().min(1),
  abiFile: z.string().min(1),
  basePath: z.string().min(1),
  defaultPriceStroops: z.coerce.number().int().min(1).default(100),
  pricingConfig: z.string().min(1).optional(),
  providerId: z.string().min(1).optional(),
  sellerId: z.string().min(1).optional(),
  beneficiaryAddress: z.string().min(1).optional()
});

const functionPricingOverrideSchema = z.union([
  z.number().int().min(0),
  z
    .object({
      priceStroops: z.number().int().min(0).optional(),
      payable: z.boolean().optional(),
      readonly: z.boolean().optional()
    })
    .strict()
]);

const pricingConfigSchema = z
  .object({
    defaultPriceStroops: z.number().int().min(1).optional(),
    functions: z.record(functionPricingOverrideSchema).optional()
  })
  .strict();

type JsonRecord = Record<string, unknown>;

type FunctionPricingOverride =
  | number
  | {
    priceStroops?: number;
    payable?: boolean;
    readonly?: boolean;
  };

type PricingConfig = {
  defaultPriceStroops?: number;
  functions?: Record<string, FunctionPricingOverride>;
};

type GatewayAbiFunctionParam = {
  name: string;
  type: string;
};

type GatewayAbiFunction = {
  name: string;
  inputs: GatewayAbiFunctionParam[];
  outputs: GatewayAbiFunctionParam[];
  readonly: boolean;
  payable: boolean;
  priceStroops: number;
  doc?: string;
};

type GatewayAbi = {
  functions: GatewayAbiFunction[];
};

type RegisterContractResult = {
  gateway: string;
  contractId: string;
  basePath: string;
  operationIds: string[];
};

type DiscoveryEndpointResult = {
  url: string;
  body: unknown;
};

function normalizeGateway(gateway: string): string {
  return gateway.replace(/\/+$/, '');
}

function toJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('ABI file must contain valid JSON');
  }
}

async function loadPricingConfig(pricingConfigPath?: string): Promise<PricingConfig | undefined> {
  if (!pricingConfigPath) {
    return undefined;
  }

  let raw: string;
  try {
    raw = await readFile(pricingConfigPath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Pricing config read failed at ${pricingConfigPath}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Pricing config at ${pricingConfigPath} must contain valid JSON`);
  }

  const validated = pricingConfigSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Pricing config validation failed at ${pricingConfigPath}: ${validated.error.message}`,
    );
  }

  return validated.data;
}

function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'undefined') {
    return 'undefined';
  }

  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? serialized : String(value);
}

function deriveSorobanType(node: unknown): string {
  if (typeof node === 'string') {
    return node;
  }

  if (!isRecord(node)) {
    return stringifyUnknown(node);
  }

  const tag = node.type;
  if (typeof tag !== 'string') {
    return stringifyUnknown(node);
  }

  switch (tag) {
    case 'bytesN': {
      const n = node.n;
      if (typeof n === 'number' && Number.isFinite(n)) {
        return `bytesN<${n}>`;
      }
      return 'bytesN';
    }
    case 'vec':
      return `vec<${deriveSorobanType(node.element)}>`;
    case 'map':
      return `map<${deriveSorobanType(node.key)}, ${deriveSorobanType(node.value)}>`;
    case 'option':
      return `option<${deriveSorobanType(node.value)}>`;
    case 'tuple': {
      const elements = Array.isArray(node.elements) ? node.elements : [];
      const rendered = elements.map((element) => deriveSorobanType(element)).join(', ');
      return `tuple<${rendered}>`;
    }
    case 'result':
      return `result<${deriveSorobanType(node.ok)}, ${deriveSorobanType(node.error)}>`;
    case 'custom': {
      const name = node.name;
      if (typeof name === 'string' && name.trim().length > 0) {
        return `custom<${name}>`;
      }
      return 'custom';
    }
    default:
      return stringifyUnknown(node);
  }
}

function convertSorobanFunction(
  entry: unknown,
  defaultPriceStroops: number,
  pricingConfig?: PricingConfig,
): GatewayAbiFunction | undefined {
  if (!isRecord(entry) || entry.type !== 'function') {
    return undefined;
  }

  const name = typeof entry.name === 'string' ? entry.name.trim() : '';
  if (name.length === 0) {
    return undefined;
  }

  const inputNodes = Array.isArray(entry.inputs) ? entry.inputs : [];
  const outputNodes = Array.isArray(entry.outputs) ? entry.outputs : [];

  const inputs = inputNodes.map((inputNode, index) => {
    const asInput = isRecord(inputNode) ? inputNode : {};
    const inputName =
      typeof asInput.name === 'string' && asInput.name.trim().length > 0 ? asInput.name : `arg${index}`;
    const typeNode = Object.prototype.hasOwnProperty.call(asInput, 'value') ? asInput.value : asInput.type;

    return {
      name: inputName,
      type: deriveSorobanType(typeNode)
    };
  });

  const outputs = outputNodes.map((outputNode, index) => ({
    name: `out${index}`,
    type: deriveSorobanType(outputNode)
  }));

  const doc = typeof entry.doc === 'string' ? entry.doc.trim() : '';
  const baselineReadonly = /^(get|list|reputation|admin)$/i.test(name);
  const baselinePayable = !baselineReadonly;
  const baselinePriceStroops = baselineReadonly ? 0 : defaultPriceStroops;

  let readonly = baselineReadonly;
  let payable = baselinePayable;
  let priceStroops = baselinePriceStroops;

  const functionOverride = pricingConfig?.functions?.[name];
  if (typeof functionOverride === 'number') {
    priceStroops = functionOverride;
    payable = functionOverride > 0;
  } else if (functionOverride) {
    if (typeof functionOverride.readonly === 'boolean') {
      readonly = functionOverride.readonly;
    }
    if (typeof functionOverride.payable === 'boolean') {
      payable = functionOverride.payable;
    }
    if (typeof functionOverride.priceStroops === 'number') {
      priceStroops = functionOverride.priceStroops;
    }
  }

  if (payable) {
    if (priceStroops <= 0) {
      priceStroops = defaultPriceStroops;
    }
  } else {
    priceStroops = 0;
  }

  return {
    name,
    inputs,
    outputs,
    readonly,
    payable,
    priceStroops,
    ...(doc.length > 0 ? { doc } : {})
  };
}

function isGatewayNativeAbi(abi: unknown): abi is GatewayAbi {
  return isRecord(abi) && Array.isArray(abi.functions);
}

function normalizeAbiForRegister(
  abi: unknown,
  defaultPriceStroops: number,
  pricingConfig?: PricingConfig,
): unknown {
  if (isGatewayNativeAbi(abi)) {
    return abi;
  }

  if (!Array.isArray(abi)) {
    return abi;
  }

  const functions = abi
    .map((entry) => convertSorobanFunction(entry, defaultPriceStroops, pricingConfig))
    .filter((entry): entry is GatewayAbiFunction => typeof entry !== 'undefined');

  return { functions };
}

function extractOperationIds(body: unknown): string[] {
  if (!body || typeof body !== 'object') {
    return [];
  }

  const candidateCollections: unknown[] = [];
  const asRecord = body as Record<string, unknown>;
  if (Array.isArray(asRecord.operationIds)) {
    candidateCollections.push(asRecord.operationIds);
  }
  if (Array.isArray(asRecord.operations)) {
    candidateCollections.push(asRecord.operations);
  }
  if (asRecord.data && typeof asRecord.data === 'object') {
    const data = asRecord.data as Record<string, unknown>;
    if (Array.isArray(data.operationIds)) {
      candidateCollections.push(data.operationIds);
    }
    if (Array.isArray(data.operations)) {
      candidateCollections.push(data.operations);
    }
  }

  for (const collection of candidateCollections) {
    if (!Array.isArray(collection)) {
      continue;
    }

    const ids = collection
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string') {
          return (entry as Record<string, unknown>).id as string;
        }
        return undefined;
      })
      .filter((id): id is string => Boolean(id));

    if (ids.length > 0) {
      return ids;
    }
  }

  return [];
}

async function registerContract(rawOptions: {
  gateway: string;
  contractId: string;
  abiFile: string;
  basePath: string;
  defaultPriceStroops: number;
  pricingConfig?: string;
  providerId?: string;
  sellerId?: string;
  beneficiaryAddress?: string;
}): Promise<RegisterContractResult> {
  const options = registerOptionsSchema.parse(rawOptions);
  const gateway = normalizeGateway(options.gateway);
  const registerUrl = `${gateway}/api/v1/contracts/register`;
  const pricingConfig = await loadPricingConfig(options.pricingConfig);
  const effectiveDefaultPrice = pricingConfig?.defaultPriceStroops ?? options.defaultPriceStroops;

  const abiRaw = await readFile(options.abiFile, 'utf8');
  const abi = normalizeAbiForRegister(toJson(abiRaw), effectiveDefaultPrice, pricingConfig);

  const response = await fetch(registerUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      contractId: options.contractId,
      abi,
      basePath: options.basePath,
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(options.sellerId ? { sellerId: options.sellerId } : {}),
      ...(options.beneficiaryAddress ? { beneficiaryAddress: options.beneficiaryAddress } : {})
    })
  });

  const responseText = await response.text();
  const responseBody = responseText ? tryParseJson(responseText) : undefined;

  if (!response.ok) {
    const renderedBody = responseBody !== undefined
      ? JSON.stringify(responseBody, null, 2)
      : responseText || 'No response body';
    throw new Error(`Register failed: ${response.status} ${response.statusText}\n${renderedBody}`);
  }

  const operationIds = extractOperationIds(responseBody);

  return {
    gateway,
    contractId: options.contractId,
    basePath: options.basePath,
    operationIds,
  };
}

async function fetchDiscoveryEndpoint(gateway: string, path: string, label: string): Promise<DiscoveryEndpointResult> {
  const url = `${gateway}${path}`;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json'
    }
  });

  const responseText = await response.text();
  const responseBody = responseText ? tryParseJson(responseText) : undefined;

  if (!response.ok) {
    const renderedBody = responseBody !== undefined
      ? JSON.stringify(responseBody, null, 2)
      : responseText || 'No response body';
    throw new Error(`Discovery fetch failed for ${label}: ${response.status} ${response.statusText}\n${renderedBody}`);
  }

  if (typeof responseBody === 'undefined') {
    throw new Error(`Discovery fetch failed for ${label}: empty JSON body`);
  }

  return {
    url,
    body: responseBody,
  };
}

function printRegisterSummary(result: RegisterContractResult): void {
  console.log('Contract registered successfully.');
  console.log(`Gateway: ${result.gateway}`);
  console.log(`Contract ID: ${result.contractId}`);
  console.log(`Base path: ${result.basePath}`);
  if (result.operationIds.length > 0) {
    console.log(`Operation IDs (${result.operationIds.length}): ${result.operationIds.join(', ')}`);
  } else {
    console.log('Operation IDs: none returned');
  }
}

async function publishContract(rawOptions: {
  gateway: string;
  contractId: string;
  abiFile: string;
  basePath: string;
  defaultPriceStroops: number;
  pricingConfig?: string;
  providerId?: string;
  sellerId?: string;
  beneficiaryAddress?: string;
}): Promise<void> {
  const registerResult = await registerContract(rawOptions);

  const [manifest, operations, openapi, agentTools] = await Promise.all([
    fetchDiscoveryEndpoint(registerResult.gateway, '/api/v1/discovery/manifest', 'manifest'),
    fetchDiscoveryEndpoint(registerResult.gateway, '/api/v1/discovery/operations', 'operations'),
    fetchDiscoveryEndpoint(registerResult.gateway, '/api/v1/discovery/openapi.json', 'openapi'),
    fetchDiscoveryEndpoint(registerResult.gateway, '/api/v1/discovery/agent-tools', 'agent-tools'),
  ]);

  const operationsPayload = isRecord(operations.body) ? operations.body : {};
  const allOperations = Array.isArray(operationsPayload.operations)
    ? operationsPayload.operations.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const contractOperations = allOperations.filter(
    (operation) => operation.contractId === registerResult.contractId,
  );

  if (contractOperations.length === 0) {
    throw new Error(
      `Publish validation failed: no operations found in discovery for contract ${registerResult.contractId}`,
    );
  }

  const discoveredOperationIds = new Set(
    contractOperations
      .map((operation) => (typeof operation.id === 'string' ? operation.id : undefined))
      .filter((id): id is string => typeof id === 'string'),
  );

  if (registerResult.operationIds.length > 0) {
    const missingIds = registerResult.operationIds.filter((id) => !discoveredOperationIds.has(id));
    if (missingIds.length > 0) {
      throw new Error(
        `Publish validation failed: operations missing from discovery: ${missingIds.join(', ')}`,
      );
    }
  }

  const agentToolsPayload = isRecord(agentTools.body) ? agentTools.body : {};
  const discoveredTools = Array.isArray(agentToolsPayload.tools)
    ? agentToolsPayload.tools.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const contractToolCount = discoveredTools.filter((tool) => {
    const toolName = typeof tool.name === 'string' ? tool.name : '';
    return discoveredOperationIds.has(toolName);
  }).length;

  if (contractToolCount === 0) {
    throw new Error(
      `Publish validation failed: no agent tools found for contract ${registerResult.contractId}`,
    );
  }

  const paidCount = contractOperations.filter((operation) => operation.paymentRequired === true).length;
  const freeCount = contractOperations.length - paidCount;

  printRegisterSummary(registerResult);
  console.log('');
  console.log('Publish summary');
  console.log(`Discovered operations for contract: ${contractOperations.length}`);
  console.log(`Paid operations: ${paidCount}`);
  console.log(`Free operations: ${freeCount}`);
  console.log(`Agent tools discovered: ${contractToolCount}`);
  console.log('');
  console.log('Shareable discovery links for agents:');
  console.log(`Manifest: ${manifest.url}`);
  console.log(`Operations: ${operations.url}`);
  console.log(`OpenAPI: ${openapi.url}`);
  console.log(`Agent tools: ${agentTools.url}`);
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('synapse')
    .description('Synapse CLI')
    .command('register')
    .description('Register a contract ABI with the gateway')
    .option('--gateway <url>', 'Gateway base URL', 'http://localhost:8787')
    .requiredOption('--contract-id <id>', 'Contract ID to register')
    .requiredOption('--abi-file <path>', 'Path to ABI JSON file')
    .option('--base-path <path>', 'Base path for generated operation routes', '/v1/ops')
    .option('--default-price-stroops <n>', 'Default price for non-readonly functions', '100')
    .option('--pricing-config <path>', 'Path to JSON pricing overrides for function pricing behavior')
    .option('--provider-id <id>', 'Optional provider identifier')
    .option('--seller-id <id>', 'Optional seller identifier')
    .option('--beneficiary-address <address>', 'Optional beneficiary Stellar address')
    .action(async (options) => {
      const result = await registerContract(options as {
        gateway: string;
        contractId: string;
        abiFile: string;
        basePath: string;
        defaultPriceStroops: number;
        pricingConfig?: string;
        providerId?: string;
        sellerId?: string;
        beneficiaryAddress?: string;
      });

      printRegisterSummary(result);
    });

  program
    .command('publish')
    .description('Register a contract ABI and verify discovery links for agent consumption')
    .option('--gateway <url>', 'Gateway base URL', 'http://localhost:8787')
    .requiredOption('--contract-id <id>', 'Contract ID to register')
    .requiredOption('--abi-file <path>', 'Path to ABI JSON file')
    .option('--base-path <path>', 'Base path for generated operation routes', '/v1/ops')
    .option('--default-price-stroops <n>', 'Default price for non-readonly functions', '100')
    .option('--pricing-config <path>', 'Path to JSON pricing overrides for function pricing behavior')
    .option('--provider-id <id>', 'Optional provider identifier')
    .option('--seller-id <id>', 'Optional seller identifier')
    .option('--beneficiary-address <address>', 'Optional beneficiary Stellar address')
    .action(async (options) => {
      await publishContract(options as {
        gateway: string;
        contractId: string;
        abiFile: string;
        basePath: string;
        defaultPriceStroops: number;
        pricingConfig?: string;
        providerId?: string;
        sellerId?: string;
        beneficiaryAddress?: string;
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CLI error: ${message}`);
  process.exit(1);
});
