# Merkle Tree Whitelist Airdrop

Task

- keep only one Merkle root on-chain
- generate proofs off-chain from a CSV
- allow each whitelisted address to claim once

## Repo structure

- `contracts/MerkleAirdrop.sol` -> main airdrop contract
- `contracts/AirdropToken.sol` -> simple ERC20 used in this project
- `scripts/generateMerkleTree.ts` -> builds Merkle root + proofs from CSV
- `scripts/deploy.ts` -> deploys contracts and funds airdrop
- `test/MerkleAirdrop.test.ts` -> test suite
- `data/whitelist.csv` -> input whitelist (`address,amount`)

## How it works (basic architecture)

1. Put addresses + amounts in `data/whitelist.csv`.
2. Run the off-chain script to generate `data/merkle-output.json`.
3. Deploy `MerkleAirdrop` with:
   - token address
   - Merkle root
   - claim deadline
4. User calls `claim(account, amount, proof)`.
5. Contract verifies proof and transfers tokens.
6. Address cannot claim again.

## Deployed contracts (Base mainnet)

- AirdropToken: `0xcc474a47ecb9d7c2e12e65f92a3cf9f8ed9b65a9`
- MerkleAirdrop: `0x08396b37754ad254eb9d233dae30daeb0f4a8aae`

BaseScan:

- https://basescan.org/address/0xcc474a47ecb9d7c2e12e65f92a3cf9f8ed9b65a9#code
- https://basescan.org/address/0x08396b37754ad254eb9d233dae30daeb0f4a8aae#code

Deployment params used:

- Merkle root: `0x9e496d76221ffd7db1146501263f9ea6933b1304c7f9f8e5c493d7898620edba`
- Claim deadline: `1830211200`
- Total allocation funded: `82800000000000000000` (82.8 tokens with 18 decimals)

## Setup

```bash
npm ci
cp .env.example .env
```

Update `.env` with your values.

Main fields:

- `PRIVATE_KEY`
- `BASE_MAINNET_RPC_URL`
- `CLAIM_DEADLINE_UNIX` (or `CLAIM_DEADLINE_ISO`)
- `DEPLOY_AIRDROP_TOKEN=true|false`
- `AIRDROP_TOKEN_ADDRESS` (needed only when `DEPLOY_AIRDROP_TOKEN=false`)
- `BASESCAN_API_KEY` (optional, for auto verify)

## Run local checks

```bash
npm run generate
npm run compile
npm test
npx tsc --noEmit
```

## Deploy

```bash
npm run generate
npm run deploy:base
```

If `BASESCAN_API_KEY` is present, verification is attempted in the deploy script.

## Manual verify (if needed)

```bash
npx hardhat verify --network base 0xcc474a47ecb9d7c2e12e65f92a3cf9f8ed9b65a9
npx hardhat verify --network base 0x08396b37754ad254eb9d233dae30daeb0f4a8aae 0xcc474a47ecb9d7c2e12e65f92a3cf9f8ed9b65a9 0x9e496d76221ffd7db1146501263f9ea6933b1304c7f9f8e5c493d7898620edba 1830211200
```

## Claim flow

1. Find user entry in `data/merkle-output.json`.
2. Take `amount` and `proof`.
3. Call `claim(account, amount, proof)` on `MerkleAirdrop`.
4. Read `claimed(account)` to confirm.

## Notes

- Amounts in CSV are raw token units (base units), not display units.
- This repo includes a simple token contract for demonstration. For production, use a proper token with your own permissions model.
