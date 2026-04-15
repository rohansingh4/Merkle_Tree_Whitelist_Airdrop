// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MerkleAirdrop
/// @notice Allows whitelisted accounts to claim a fixed ERC-20 allocation
///         by submitting a Merkle proof generated off-chain.
contract MerkleAirdrop is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The ERC-20 token distributed by this airdrop.
    IERC20 public immutable token;

    /// @notice Merkle root of the whitelist tree, set once at deployment.
    bytes32 public immutable merkleRoot;

    /// @notice Final timestamp (unix seconds) when claims are still accepted.
    uint256 public immutable claimDeadline;

    /// @notice Tracks which addresses have already claimed.
    mapping(address => bool) public claimed;

    /// @notice Emitted on every successful claim.
    event Claimed(address indexed account, uint256 amount);

    /// @notice Emitted when remaining tokens are swept after claim window.
    event Swept(address indexed to, uint256 amount);

    error AlreadyClaimed();
    error InvalidProof();
    error ZeroAddress();
    error InvalidMerkleRoot();
    error InvalidDeadline();
    error ClaimWindowClosed();
    error ClaimWindowStillOpen();

    /// @param _token         Address of the ERC-20 token to distribute.
    /// @param _merkleRoot    Merkle root produced by the off-chain script.
    /// @param _claimDeadline Last timestamp at which claim() is allowed.
    constructor(address _token, bytes32 _merkleRoot, uint256 _claimDeadline) Ownable(msg.sender) {
        if (_token == address(0)) revert ZeroAddress();
        if (_merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (_claimDeadline <= block.timestamp) revert InvalidDeadline();

        token = IERC20(_token);
        merkleRoot = _merkleRoot;
        claimDeadline = _claimDeadline;
    }

    /// @notice Claim the airdrop allocation for `account`.
    /// @param account Address to receive the tokens.
    /// @param amount  Amount in token base units from the whitelist.
    /// @param proof   Merkle proof from the off-chain script.
    function claim(address account, uint256 amount, bytes32[] calldata proof) external nonReentrant {
        if (block.timestamp > claimDeadline) revert ClaimWindowClosed();
        if (account == address(0)) revert ZeroAddress();
        if (claimed[account]) revert AlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
        if (!MerkleProof.verify(proof, merkleRoot, leaf)) revert InvalidProof();

        claimed[account] = true;
        token.safeTransfer(account, amount);

        emit Claimed(account, amount);
    }

    /// @notice Sweep any remaining tokens after the claim window has ended.
    /// @param to Destination address for remaining tokens.
    function sweep(address to) external onlyOwner {
        if (block.timestamp <= claimDeadline) revert ClaimWindowStillOpen();
        if (to == address(0)) revert ZeroAddress();

        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(to, balance);

        emit Swept(to, balance);
    }

    /// @notice True when current block timestamp is within claim window.
    function isClaimOpen() external view returns (bool) {
        return block.timestamp <= claimDeadline;
    }
}
