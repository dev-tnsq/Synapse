import { GatewayError, type CanonicalOperationSpec, type HttpMethod } from "../types/canonical";

function routeKey(method: HttpMethod, path: string): string {
  return `${method} ${path}`;
}

export class OperationRegistry {
  private readonly byId = new Map<string, CanonicalOperationSpec>();
  private readonly byRoute = new Map<string, CanonicalOperationSpec>();

  public constructor(initialOperations: readonly CanonicalOperationSpec[] = []) {
    for (const operation of initialOperations) {
      this.register(operation);
    }
  }

  public register(operation: CanonicalOperationSpec): void {
    if (this.byId.has(operation.id)) {
      throw new GatewayError("INVALID_REQUEST", `Duplicate operation id: ${operation.id}`, 500);
    }

    const key = routeKey(operation.method, operation.path);
    if (this.byRoute.has(key)) {
      throw new GatewayError("INVALID_REQUEST", `Duplicate route mapping: ${key}`, 500);
    }

    this.byId.set(operation.id, operation);
    this.byRoute.set(key, operation);
  }

  public getById(operationId: string): CanonicalOperationSpec | undefined {
    return this.byId.get(operationId);
  }

  public getByRoute(method: HttpMethod, path: string): CanonicalOperationSpec | undefined {
    return this.byRoute.get(routeKey(method, path));
  }

  public list(): readonly CanonicalOperationSpec[] {
    return Array.from(this.byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }
}
