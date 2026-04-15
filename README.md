# Merkle Tree Whitelist Airdrop

This is my Hardhat project for a Merkle whitelist airdrop on Base.

The idea is simple:
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

- AirdropToken: `0x4836ae13b84f00cffacd8d963347de9b4dcec920`
- MerkleAirdrop: `0xa654b8141060c1ee9f26fa43836b1c746891e58e`

BaseScan:
- https://basescan.org/address/0x4836ae13b84f00cffacd8d963347de9b4dcec920#code
- https://basescan.org/address/0xa654b8141060c1ee9f26fa43836b1c746891e58e#code

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
npx hardhat verify --network base 0x4836ae13b84f00cffacd8d963347de9b4dcec920
npx hardhat verify --network base 0xa654b8141060c1ee9f26fa43836b1c746891e58e 0x4836ae13b84f00cffacd8d963347de9b4dcec920 0xe7584d375e11dc4c708e3c2c188ed75c8c6fe773cb6f81ba56321195247417c5 1830211200
```

## Claim flow

1. Find user entry in `data/merkle-output.json`.
2. Take `amount` and `proof`.
3. Call `claim(account, amount, proof)` on `MerkleAirdrop`.
4. Read `claimed(account)` to confirm.

## Notes

- Amounts in CSV are raw token units (base units), not display units.
- This repo includes a simple token contract for demonstration. For production, use a proper token with your own permissions model.
