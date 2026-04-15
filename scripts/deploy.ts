/**
 * deploy.ts
 *
 * Deploys MerkleAirdrop to Base mainnet.
 *
 * Modes:
 *   1) Existing token (default): uses AIRDROP_TOKEN_ADDRESS
 *   2) Deploy token first: set DEPLOY_AIRDROP_TOKEN=true
 *
 * Then funds the airdrop contract with exact whitelist total and optionally verifies.
 *
 * Prerequisites:
 *   1. Run `npx ts-node scripts/generateMerkleTree.ts` first.
 *   2. Fill in .env (see .env.example).
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network base
 */

import hre from "hardhat";
import fs from "fs";
import path from "path";
import { erc20Abi, getAddress, isAddress } from "viem";

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
}

function parseClaimDeadline(): bigint {
  const unix = process.env.CLAIM_DEADLINE_UNIX;
  const iso = process.env.CLAIM_DEADLINE_ISO;

  if (!unix && !iso) {
    throw new Error("Set CLAIM_DEADLINE_UNIX or CLAIM_DEADLINE_ISO");
  }

  if (unix) {
    if (!/^\d+$/.test(unix)) {
      throw new Error(`Invalid CLAIM_DEADLINE_UNIX: ${unix}`);
    }
    return BigInt(unix);
  }

  const ms = Date.parse(iso as string);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid CLAIM_DEADLINE_ISO: ${iso}`);
  }
  return BigInt(Math.floor(ms / 1000));
}

function isBytes32Hex(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

function envTrue(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "true";
}

async function waitForContractCode(
  publicClient: Awaited<ReturnType<typeof hre.viem.getPublicClient>>,
  address: `0x${string}`,
  label: string
): Promise<void> {
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    const code = await publicClient.getBytecode({ address });
    if (code && code !== "0x") {
      return;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`${label} code not available on-chain after waiting: ${address}`);
}

async function waitForTokenBalanceAtLeast(
  publicClient: Awaited<ReturnType<typeof hre.viem.getPublicClient>>,
  tokenAddress: `0x${string}`,
  holder: `0x${string}`,
  expectedMin: bigint
): Promise<bigint> {
  const maxAttempts = 30;
  let last = 0n;
  for (let i = 0; i < maxAttempts; i++) {
    last = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder],
    });
    if (last >= expectedMin) return last;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return last;
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const chainId = await publicClient.getChainId();
  if (chainId !== 8453) {
    throw new Error(`Wrong network: expected Base mainnet (8453), got ${chainId}`);
  }

  console.log("Deployer:", deployer.account.address);

  const deployTokenFirst = envTrue("DEPLOY_AIRDROP_TOKEN");
  let tokenAddress: `0x${string}`;

  if (deployTokenFirst) {
    console.log("DEPLOY_AIRDROP_TOKEN=true -> deploying AirdropToken first...");
    const token = await hre.viem.deployContract("AirdropToken");
    tokenAddress = token.address;
    await waitForContractCode(publicClient, tokenAddress, "AirdropToken");
    console.log("AirdropToken:", tokenAddress);
  } else {
    const rawTokenAddress = getRequiredEnv("AIRDROP_TOKEN_ADDRESS");
    if (!isAddress(rawTokenAddress)) {
      throw new Error(`Invalid AIRDROP_TOKEN_ADDRESS: ${rawTokenAddress}`);
    }
    tokenAddress = getAddress(rawTokenAddress);
  }

  const claimDeadline = parseClaimDeadline();
  const latestBlock = await publicClient.getBlock();
  const now = latestBlock.timestamp;
  if (claimDeadline <= now) {
    throw new Error(
      `Claim deadline must be in the future. now=${now.toString()} deadline=${claimDeadline.toString()}`
    );
  }

  const outputPath = path.join(__dirname, "../data/merkle-output.json");
  if (!fs.existsSync(outputPath)) {
    throw new Error("data/merkle-output.json not found — run generateMerkleTree.ts first");
  }

  const parsedOutput = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    root: string;
    entries: { amount: string }[];
  };

  if (!isBytes32Hex(parsedOutput.root)) {
    throw new Error(`Invalid merkle root in output file: ${parsedOutput.root}`);
  }
  const merkleRoot = parsedOutput.root;

  if (!Array.isArray(parsedOutput.entries) || parsedOutput.entries.length === 0) {
    throw new Error("merkle-output.json must contain at least one entry");
  }
  const total = parsedOutput.entries.reduce((acc, e) => acc + BigInt(e.amount), 0n);

  console.log("Token:", tokenAddress);
  console.log("Merkle root:", merkleRoot);
  console.log("Claim deadline (unix):", claimDeadline.toString());
  console.log("Total allocation (raw units):", total.toString());

  try {
    const tokenDecimals = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "decimals",
    });
    console.log("Token decimals:", tokenDecimals);
  } catch {
    console.log("Token decimals: unavailable (continuing deployment)");
  }

  console.log("\nDeploying MerkleAirdrop...");
  const airdrop = await hre.viem.deployContract("MerkleAirdrop", [
    tokenAddress,
    merkleRoot,
    claimDeadline,
  ]);
  await waitForContractCode(publicClient, airdrop.address, "MerkleAirdrop");
  console.log("MerkleAirdrop:", airdrop.address);

  if (deployTokenFirst) {
    console.log("Minting total supply directly to airdrop contract...");
    const token = await hre.viem.getContractAt("AirdropToken", tokenAddress, {
      client: { wallet: deployer },
    });
    const mintTx = await token.write.mint([airdrop.address, total]);
    await publicClient.waitForTransactionReceipt({ hash: mintTx });
    console.log("Contract funded via mint.");
  } else {
    const deployerTokenBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [deployer.account.address],
    });

    if (deployerTokenBalance < total) {
      throw new Error(
        `Insufficient deployer token balance: have ${deployerTokenBalance.toString()} need ${total.toString()}`
      );
    }

    console.log("Funding airdrop contract via transfer...");
    const fundingTx = await deployer.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [airdrop.address, total],
      account: deployer.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: fundingTx });
    console.log("Contract funded via transfer.");
  }

  const contractBalance = await waitForTokenBalanceAtLeast(
    publicClient,
    tokenAddress,
    airdrop.address,
    total
  );
  if (contractBalance < total) {
    throw new Error("Funding verification failed: airdrop contract balance is lower than expected");
  }

  if (process.env.BASESCAN_API_KEY) {
    console.log("\nWaiting 15s before verification...");
    await new Promise((r) => setTimeout(r, 15_000));

    if (deployTokenFirst) {
      await hre.run("verify:verify", {
        address: tokenAddress,
        constructorArguments: [],
      });
    }

    await hre.run("verify:verify", {
      address: airdrop.address,
      constructorArguments: [tokenAddress, merkleRoot, claimDeadline],
    });
    console.log("Verification complete.");
  }

  console.log("\n--- Deployment summary ---");
  console.log("MerkleAirdrop :", airdrop.address);
  console.log("Token         :", tokenAddress);
  console.log("Token Mode    :", deployTokenFirst ? "deployed by script" : "existing token");
  console.log("Merkle Root   :", merkleRoot);
  console.log("Deadline      :", claimDeadline.toString());
  console.log("Network       :", hre.network.name);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
