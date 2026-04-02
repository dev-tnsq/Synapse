import type {
  CanonicalFieldSchema,
  CanonicalOperationSpec,
  CanonicalScalarType,
} from "../types/canonical";

export interface SorobanAbiArg {
  readonly name: string;
  readonly type: string;
  readonly required?: boolean;
  readonly doc?: string;
}

export interface SorobanAbiFn {
  readonly name: string;
  readonly doc?: string;
  readonly readonly?: boolean;
  readonly payable?: boolean;
  readonly priceStroops?: number;
  readonly inputs: readonly SorobanAbiArg[];
  readonly outputs?: readonly SorobanAbiArg[];
}

export interface SorobanContractAbi {
  readonly functions: readonly SorobanAbiFn[];
}

function normalizeType(input: string): CanonicalScalarType {
  const lower = input.toLowerCase();
  if (lower.includes("bool")) {
    return "boolean";
  }
  if (lower.includes("i") || lower.includes("u") || lower.includes("number")) {
    return "number";
  }
  if (lower.includes("vec") || lower.includes("array") || lower.includes("list")) {
    return "array";
  }
  if (lower.includes("map") || lower.includes("obj") || lower.includes("struct")) {
    return "object";
  }
  return "string";
}

function toFieldSchema(args: readonly SorobanAbiArg[]): Readonly<Record<string, CanonicalFieldSchema>> {
  const result: Record<string, CanonicalFieldSchema> = {};
  for (const arg of args) {
    result[arg.name] = {
      type: normalizeType(arg.type),
      required: arg.required ?? true,
      description: arg.doc,
    };
  }
  return result;
}

export function parseSorobanAbiToCanonical(
  contractId: string,
  abi: SorobanContractAbi,
  basePath = "/operations",
): readonly CanonicalOperationSpec[] {
  return abi.functions.map((fn) => {
    const method = fn.readonly ? "GET" : "POST";
    return {
      id: `${contractId}.${fn.name}`,
      contractId,
      functionName: fn.name,
      title: fn.name,
      description: fn.doc ?? `${contractId}:${fn.name}`,
      method,
      path: `${basePath}/${contractId}/${fn.name}`,
      paymentRequired: fn.payable ?? true,
      priceStroops: fn.priceStroops ?? 0,
      request:
        method === "GET"
          ? { query: toFieldSchema(fn.inputs) }
          : { body: toFieldSchema(fn.inputs) },
      response: {
        data: toFieldSchema(fn.outputs ?? []),
      },
    };
  });
}
