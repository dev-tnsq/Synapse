#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';

const registerOptionsSchema = z.object({
  gateway: z.string().url(),
  contractId: z.string().min(1),
  abiFile: z.string().min(1),
  basePath: z.string().min(1),
  defaultPriceStroops: z.coerce.number().int().min(1).default(100)
});

type JsonRecord = Record<string, unknown>;

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

function convertSorobanFunction(entry: unknown, defaultPriceStroops: number): GatewayAbiFunction | undefined {
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
  const readonly = /^(get|list|reputation|admin)$/i.test(name);

  return {
    name,
    inputs,
    outputs,
    readonly,
    payable: !readonly,
    priceStroops: readonly ? 0 : defaultPriceStroops,
    ...(doc.length > 0 ? { doc } : {})
  };
}

function isGatewayNativeAbi(abi: unknown): abi is GatewayAbi {
  return isRecord(abi) && Array.isArray(abi.functions);
}

function normalizeAbiForRegister(abi: unknown, defaultPriceStroops: number): unknown {
  if (isGatewayNativeAbi(abi)) {
    return abi;
  }

  if (!Array.isArray(abi)) {
    return abi;
  }

  const functions = abi
    .map((entry) => convertSorobanFunction(entry, defaultPriceStroops))
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
}): Promise<void> {
  const options = registerOptionsSchema.parse(rawOptions);
  const gateway = normalizeGateway(options.gateway);
  const registerUrl = `${gateway}/api/v1/contracts/register`;

  const abiRaw = await readFile(options.abiFile, 'utf8');
  const abi = normalizeAbiForRegister(toJson(abiRaw), options.defaultPriceStroops);

  const response = await fetch(registerUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      contractId: options.contractId,
      abi,
      basePath: options.basePath
    })
  });

  const responseText = await response.text();
  const responseBody = responseText ? toJson(responseText) : undefined;

  if (!response.ok) {
    console.error(`Register failed: ${response.status} ${response.statusText}`);
    if (responseBody !== undefined) {
      console.error(JSON.stringify(responseBody, null, 2));
    } else {
      console.error(responseText);
    }
    process.exit(1);
  }

  const operationIds = extractOperationIds(responseBody);
  console.log('Contract registered successfully.');
  console.log(`Gateway: ${gateway}`);
  console.log(`Contract ID: ${options.contractId}`);
  console.log(`Base path: ${options.basePath}`);
  if (operationIds.length > 0) {
    console.log(`Operation IDs (${operationIds.length}): ${operationIds.join(', ')}`);
  } else {
    console.log('Operation IDs: none returned');
  }
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
    .action(async (options) => {
      await registerContract(options as {
        gateway: string;
        contractId: string;
        abiFile: string;
        basePath: string;
        defaultPriceStroops: number;
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CLI error: ${message}`);
  process.exit(1);
});
