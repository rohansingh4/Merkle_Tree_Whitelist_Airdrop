import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import {
  decodeEventLog,
  getAddress,
  parseAbiItem,
  parseUnits,
  zeroAddress,
} from "viem";

const DEC = 18;
const ONE_DAY = 24n * 60n * 60n;

function getProof(
  tree: StandardMerkleTree<[string, string]>,
  address: string
): `0x${string}`[] {
  for (const [i, [addr]] of tree.entries()) {
    if (addr.toLowerCase() === address.toLowerCase()) {
      return tree.getProof(i) as `0x${string}`[];
    }
  }
  throw new Error(`Address ${address} not found in tree`);
}

function getAllocation(
  tree: StandardMerkleTree<[string, string]>,
  address: string
): bigint {
  for (const [, [addr, amount]] of tree.entries()) {
    if (addr.toLowerCase() === address.toLowerCase()) {
      return BigInt(amount);
    }
  }
  throw new Error(`Address ${address} not found in tree`);
}

async function setNextTimestamp(timestamp: bigint) {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(timestamp)]);
  await hre.network.provider.send("evm_mine");
}

async function deployFixture() {
  const [owner, alice, bob, carol, dave, attacker] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const whitelistEntries: [string, string][] = [
    [alice.account.address, parseUnits("100", DEC).toString()],
    [bob.account.address, parseUnits("200", DEC).toString()],
    [carol.account.address, parseUnits("150", DEC).toString()],
  ];

  const tree = StandardMerkleTree.of(whitelistEntries, ["address", "uint256"]);
  const root = tree.root as `0x${string}`;

  const token = await hre.viem.deployContract("AirdropToken");

  const block = await publicClient.getBlock();
  const claimDeadline = block.timestamp + (7n * ONE_DAY);

  const airdrop = await hre.viem.deployContract("MerkleAirdrop", [
    token.address,
    root,
    claimDeadline,
  ]);

  const totalAirdrop = parseUnits("1000", DEC);
  await token.write.mint([airdrop.address, totalAirdrop]);

  return {
    token,
    airdrop,
    tree,
    root,
    claimDeadline,
    owner,
    alice,
    bob,
    carol,
    dave,
    attacker,
    publicClient,
  };
}

describe("MerkleAirdrop", function () {
  describe("Deployment", function () {
    it("stores token + merkle root + claim deadline immutably", async function () {
      const { airdrop, token, root, claimDeadline } = await loadFixture(deployFixture);

      expect(await airdrop.read.token()).to.equal(getAddress(token.address));
      expect(await airdrop.read.merkleRoot()).to.equal(root);
      expect(await airdrop.read.claimDeadline()).to.equal(claimDeadline);
    });

    it("reverts construction with zero-address token", async function () {
      const { root, claimDeadline } = await loadFixture(deployFixture);

      await expect(
        hre.viem.deployContract("MerkleAirdrop", [zeroAddress, root, claimDeadline])
      ).to.be.rejectedWith("ZeroAddress");
    });

    it("reverts construction with zero merkle root", async function () {
      const { token, claimDeadline } = await loadFixture(deployFixture);
      const zeroRoot = `0x${"00".repeat(32)}` as `0x${string}`;

      await expect(
        hre.viem.deployContract("MerkleAirdrop", [token.address, zeroRoot, claimDeadline])
      ).to.be.rejectedWith("InvalidMerkleRoot");
    });

    it("reverts construction with non-future deadline", async function () {
      const { token, root, publicClient } = await loadFixture(deployFixture);
      const currentTs = (await publicClient.getBlock()).timestamp;

      await expect(
        hre.viem.deployContract("MerkleAirdrop", [token.address, root, currentTs])
      ).to.be.rejectedWith("InvalidDeadline");
    });
  });

  describe("claim — valid proofs", function () {
    it("supports 3 valid claims (alice/bob/carol)", async function () {
      const { airdrop, token, alice, bob, carol, tree } = await loadFixture(deployFixture);

      for (const user of [alice, bob, carol]) {
        const amount = getAllocation(tree, user.account.address);
        const proof = getProof(tree, user.account.address);

        const before = (await token.read.balanceOf([user.account.address])) as bigint;
        await airdrop.write.claim([user.account.address, amount, proof]);
        const after = (await token.read.balanceOf([user.account.address])) as bigint;

        expect(after - before).to.equal(amount);
        expect(await airdrop.read.claimed([user.account.address])).to.equal(true);
      }
    });

    it("emits Claimed(account, amount)", async function () {
      const { airdrop, alice, tree, publicClient } = await loadFixture(deployFixture);
      const amount = getAllocation(tree, alice.account.address);
      const proof = getProof(tree, alice.account.address);

      const txHash = await airdrop.write.claim([alice.account.address, amount, proof]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      const airdropLog = receipt.logs.find(
        (log) => log.address.toLowerCase() === airdrop.address.toLowerCase()
      );
      expect(airdropLog).to.not.equal(undefined);

      const decoded = decodeEventLog({
        abi: [parseAbiItem("event Claimed(address indexed account, uint256 amount)")],
        data: airdropLog!.data,
        topics: airdropLog!.topics,
      });

      expect(getAddress(decoded.args.account as string)).to.equal(getAddress(alice.account.address));
      expect(decoded.args.amount).to.equal(amount);
    });

    it("allows third-party relay claim", async function () {
      const { airdrop, token, alice, attacker, tree } = await loadFixture(deployFixture);

      const amount = getAllocation(tree, alice.account.address);
      const proof = getProof(tree, alice.account.address);

      const attackerAirdrop = await hre.viem.getContractAt(
        "MerkleAirdrop",
        airdrop.address,
        { client: { wallet: attacker } }
      );

      await attackerAirdrop.write.claim([alice.account.address, amount, proof]);
      expect(await token.read.balanceOf([alice.account.address])).to.equal(amount);
      expect(await token.read.balanceOf([attacker.account.address])).to.equal(0n);
    });
  });

  describe("claim — invalid attempts", function () {
    it("reverts with InvalidProof for wrong proof", async function () {
      const { airdrop, alice, tree } = await loadFixture(deployFixture);
      const amount = getAllocation(tree, alice.account.address);

      const fakeProof: `0x${string}`[] = [
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ];

      await expect(
        airdrop.write.claim([alice.account.address, amount, fakeProof])
      ).to.be.rejectedWith("InvalidProof");
    });

    it("reverts with AlreadyClaimed on second claim", async function () {
      const { airdrop, alice, tree } = await loadFixture(deployFixture);
      const amount = getAllocation(tree, alice.account.address);
      const proof = getProof(tree, alice.account.address);

      await airdrop.write.claim([alice.account.address, amount, proof]);

      await expect(
        airdrop.write.claim([alice.account.address, amount, proof])
      ).to.be.rejectedWith("AlreadyClaimed");
    });

    it("reverts with InvalidProof for wrong amount", async function () {
      const { airdrop, alice, tree } = await loadFixture(deployFixture);
      const proof = getProof(tree, alice.account.address);

      await expect(
        airdrop.write.claim([alice.account.address, parseUnits("999", DEC), proof])
      ).to.be.rejectedWith("InvalidProof");
    });

    it("reverts with InvalidProof for non-whitelisted user", async function () {
      const { airdrop, dave } = await loadFixture(deployFixture);
      const fakeProof: `0x${string}`[] = [
        "0x0000000000000000000000000000000000000000000000000000000000000042",
      ];

      await expect(
        airdrop.write.claim([dave.account.address, parseUnits("100", DEC), fakeProof])
      ).to.be.rejectedWith("InvalidProof");
    });

    it("reverts claim after deadline", async function () {
      const { airdrop, alice, tree, claimDeadline } = await loadFixture(deployFixture);
      await setNextTimestamp(claimDeadline + 1n);

      const amount = getAllocation(tree, alice.account.address);
      const proof = getProof(tree, alice.account.address);

      await expect(
        airdrop.write.claim([alice.account.address, amount, proof])
      ).to.be.rejectedWith("ClaimWindowClosed");
    });
  });

  describe("sweep", function () {
    it("reverts before claim window closes", async function () {
      const { airdrop, owner } = await loadFixture(deployFixture);

      await expect(
        airdrop.write.sweep([owner.account.address])
      ).to.be.rejectedWith("ClaimWindowStillOpen");
    });

    it("owner can sweep after deadline", async function () {
      const { airdrop, token, owner, claimDeadline } = await loadFixture(deployFixture);
      await setNextTimestamp(claimDeadline + 1n);

      const remainingBefore = await token.read.balanceOf([airdrop.address]);
      await airdrop.write.sweep([owner.account.address]);

      expect(await token.read.balanceOf([airdrop.address])).to.equal(0n);
      expect(await token.read.balanceOf([owner.account.address])).to.equal(remainingBefore);
    });

    it("non-owner cannot sweep", async function () {
      const { airdrop, attacker, claimDeadline } = await loadFixture(deployFixture);
      await setNextTimestamp(claimDeadline + 1n);

      const attackerAirdrop = await hre.viem.getContractAt(
        "MerkleAirdrop",
        airdrop.address,
        { client: { wallet: attacker } }
      );

      await expect(
        attackerAirdrop.write.sweep([attacker.account.address])
      ).to.be.rejectedWith("OwnableUnauthorizedAccount");
    });

    it("reverts sweep with zero destination", async function () {
      const { airdrop, claimDeadline } = await loadFixture(deployFixture);
      await setNextTimestamp(claimDeadline + 1n);

      await expect(
        airdrop.write.sweep([zeroAddress])
      ).to.be.rejectedWith("ZeroAddress");
    });
  });
});
