# Release Readiness

## Completed publish/deploy assets

- Root README updated with local run order and deploy flow.
- CLI implementation for contract registration added in tools/cli.
- CLI documentation and publish checklist added.
- Contract deployment script available at contracts/scripts/deploy.sh.
- Contract artifacts output location defined at contracts/artifacts.

## Execution order for release day

1. Deploy contracts:
- Run: bash contracts/scripts/deploy.sh
- Capture resulting contract IDs and generated deployment files.
2. Load gateway environment:
- Export values from contracts/artifacts/deployments.<network>.env.
- Start gateway with production-like environment settings.
3. Run CLI publish check:
- Execute: npm run cli:publish:check
- If successful, proceed to npm publish --access public for tools/cli.

## Evidence to capture

- Contract IDs for registry and receipt contracts.
- Transaction hashes for deployment and initialization calls.
- Contract registration output including operation list from CLI register command.
- Smoke invocation output proving request, payment verification path, and response path.

## Remaining implementation gaps

- Real operation executor wiring is still pending (placeholder behavior currently present).
- Durable persistence is required to replace in-memory stores.
- Authenticated facilitator flow is not fully implemented.

## Go/No-Go checklist

- [ ] Contracts build successfully for wasm target.
- [ ] Contracts tests pass.
- [ ] Deployment script completes on target network.
- [ ] Deployment env file is generated and loaded by gateway.
- [ ] Gateway starts cleanly with release configuration.
- [ ] CLI typecheck, build, and publish check pass.
- [ ] Contract registration returns expected operation list.
- [ ] Smoke invocation produces expected output and logs.
- [ ] Required evidence artifacts are archived.
- [ ] Remaining gaps accepted and documented for follow-up.
