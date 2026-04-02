import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import { z } from 'zod';

const registerOptionsSchema = z.object({
  gateway: z.string().url(),
  contractId: z.string().min(1),
  abiFile: z.string().min(1),
  basePath: z.string().min(1)
});

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
}): Promise<void> {
  const options = registerOptionsSchema.parse(rawOptions);
  const gateway = normalizeGateway(options.gateway);
  const registerUrl = `${gateway}/api/v1/contracts/register`;

  const abiRaw = await readFile(options.abiFile, 'utf8');
  const abi = toJson(abiRaw);

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
    .action(async (options) => {
      await registerContract(options as {
        gateway: string;
        contractId: string;
        abiFile: string;
        basePath: string;
      });
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CLI error: ${message}`);
  process.exit(1);
});
