---
name: mcp-gateway-tooling
description: "Design and implement MCP gateway behavior for paid contract tools. Use when mapping ABI to tools, defining handlers, and orchestrating paid invocation pipelines."
argument-hint: "Describe gateway feature, current architecture, and integration target"
user-invocable: true
---

# MCP Gateway Tooling

## Outcome
Define or implement MCP server behavior for dynamic paid tool execution.

## Procedure
1. Map capability to MCP tool/resource/prompt primitives.
2. Define tool schemas and validation rules.
3. Define paid invocation flow with x402 middleware.
4. Add observability and audit fields per call.
5. Validate with integration scenario.

## Output Format
1. MCP capability map
2. Tool definitions
3. Execution flow
4. Error handling
5. Test plan

## Completion Criteria
- Tool contracts are stable and versionable.
- Paid calls are auditable from request to chain proof.
