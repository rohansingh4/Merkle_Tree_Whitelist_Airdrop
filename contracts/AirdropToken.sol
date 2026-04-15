// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title AirdropToken
/// @notice Minimal ERC-20 used to fund the MerkleAirdrop contract in tests.
///         Public mint is intentional — test helper only, NOT for production.
contract AirdropToken is ERC20 {
    constructor() ERC20("Airdrop Token", "ADT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
