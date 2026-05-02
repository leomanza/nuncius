// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

// Force hardhat to compile every contract we will deploy.
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";

contract Probe {}
