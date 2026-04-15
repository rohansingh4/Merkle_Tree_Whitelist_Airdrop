/**
 * generateMerkleTree.ts
 *
 * Off-chain script: reads whitelist.csv -> builds a StandardMerkleTree ->
 * writes data/merkle-output.json containing the root and each address's proof.
 *
 * Usage:
 *   npx ts-node scripts/generateMerkleTree.ts [path/to/whitelist.csv]
 */

import fs from "fs";
import path from "path";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, isAddress } from "viem";

function validateRawAmount(raw: string, line: number): string {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid amount at line ${line}: expected uint256 integer base units, got "${raw}"`);
  }

  const amount = BigInt(raw);
  if (amount <= 0n) {
    throw new Error(`Invalid amount at line ${line}: amount must be > 0`);
  }

  return raw;
}

function parseCsv(csvPath: string): [string, string][] {
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("CSV must include header + at least one whitelist row");
  }

  const [header, ...rows] = lines;
  const normalizedHeader = header.replace(/\s+/g, "").toLowerCase();
  if (normalizedHeader !== "address,amount") {
    throw new Error(`Invalid CSV header: expected "address,amount", got "${header}"`);
  }

  const seen = new Set<string>();
  const entries: [string, string][] = [];

  rows.forEach((line, index) => {
    const lineNo = index + 2;
    const [rawAddress, rawAmount] = line.split(",").map((s) => s.trim());

    if (!rawAddress || !rawAmount) {
      throw new Error(`Malformed CSV line ${lineNo}: "${line}"`);
    }

    if (!isAddress(rawAddress)) {
      throw new Error(`Invalid address at line ${lineNo}: "${rawAddress}"`);
    }

    const address = getAddress(rawAddress);
    const dedupeKey = address.toLowerCase();
    if (seen.has(dedupeKey)) {
      throw new Error(`Duplicate address in whitelist at line ${lineNo}: ${address}`);
    }
    seen.add(dedupeKey);

    const amount = validateRawAmount(rawAmount, lineNo);
    entries.push([address, amount]);
  });

  return entries;
}

function main() {
  const csvPath = process.argv[2] ?? path.join(__dirname, "../data/whitelist.csv");

  console.log(`Reading whitelist from: ${csvPath}`);
  const entries = parseCsv(csvPath);
  console.log(`  ${entries.length} entries found`);

  const tree = StandardMerkleTree.of(entries, ["address", "uint256"]);
  console.log(`\nMerkle Root: ${tree.root}`);

  const output: {
    root: string;
    entries: { address: string; amount: string; proof: string[] }[];
  } = {
    root: tree.root,
    entries: [],
  };

  for (const [i, [address, amount]] of tree.entries()) {
    output.entries.push({
      address,
      amount,
      proof: tree.getProof(i),
    });
  }

  const outPath = path.join(__dirname, "../data/merkle-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nProofs written to: ${outPath}`);
  console.log("Use this root and claim deadline in deploy.ts constructor args.");
}

main();
