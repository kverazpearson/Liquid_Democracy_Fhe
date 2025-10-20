pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract LiquidDemocracyFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public currentBatchId;
    bool public batchOpen;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    // Encrypted state
    mapping(uint256 => mapping(address => euint32)) public encryptedVotes; // batchId => voter => encryptedVote
    mapping(uint256 => mapping(address => euint32)) public encryptedDelegations; // batchId => delegator => encryptedDelegateeAddress
    mapping(uint256 => euint32) public encryptedTotalForOptionA; // batchId => encryptedTotalForOptionA
    mapping(uint256 => euint32) public encryptedTotalForOptionB; // batchId => encryptedTotalForOptionB

    // Clear results
    mapping(uint256 => uint32) public clearTotalForOptionA;
    mapping(uint256 => uint32) public clearTotalForOptionB;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error InvalidBatch();
    error ReplayDetected();
    error StateMismatch();
    error InvalidProof();
    error NotInitialized();

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused();
    event ContractUnpaused();
    event CooldownSecondsChanged(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 batchId);
    event BatchClosed(uint256 batchId);
    event VoteSubmitted(address indexed voter, uint256 batchId);
    event DelegationSubmitted(address indexed delegator, address indexed delegatee, uint256 batchId);
    event DecryptionRequested(uint256 requestId, uint256 batchId);
    event DecryptionCompleted(uint256 requestId, uint256 batchId, uint32 totalA, uint32 totalB);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        providers[owner] = true;
        emit ProviderAdded(owner);
        currentBatchId = 0;
        batchOpen = false;
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        delete providers[provider];
        emit ProviderRemoved(provider);
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit ContractPaused();
    }

    function unpause() external onlyOwner {
        if (!paused) revert Paused(); // Already unpaused
        paused = false;
        emit ContractUnpaused();
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsChanged(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchClosed(); // Or a more specific error like BatchAlreadyOpen
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchClosed(); // Or a more specific error like BatchAlreadyClosed
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitVote(uint256 batchId, euint32 encryptedVote) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId != currentBatchId || !batchOpen) {
            revert InvalidBatch();
        }
        _initIfNeeded(encryptedVote);

        encryptedVotes[batchId][msg.sender] = encryptedVote;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit VoteSubmitted(msg.sender, batchId);
    }

    function submitDelegation(uint256 batchId, euint32 encryptedDelegateeAddress) external onlyProvider whenNotPaused {
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId != currentBatchId || !batchOpen) {
            revert InvalidBatch();
        }
        _initIfNeeded(encryptedDelegateeAddress);

        encryptedDelegations[batchId][msg.sender] = encryptedDelegateeAddress;
        lastSubmissionTime[msg.sender] = block.timestamp;
        emit DelegationSubmitted(msg.sender, address(uint160(encryptedDelegateeAddress.toUint32())), batchId); // Note: toUint32 on encrypted data is for placeholder, real decryption happens later
    }

    function requestBatchResultsDecryption(uint256 batchId) external onlyProvider whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        if (batchId >= currentBatchId || batchOpen) { // Cannot decrypt current open batch or future batch
            revert InvalidBatch();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32 memory totalA = encryptedTotalForOptionA[batchId];
        euint32 memory totalB = encryptedTotalForOptionB[batchId];
        _initIfNeeded(totalA);
        _initIfNeeded(totalB);

        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(totalA);
        cts[1] = FHE.toBytes32(totalB);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) {
            revert ReplayDetected();
        }
        // Security: Replay protection ensures this callback is processed only once for a given requestId.

        DecryptionContext memory ctx = decryptionContexts[requestId];
        uint256 batchId = ctx.batchId;

        euint32 memory totalA = encryptedTotalForOptionA[batchId];
        euint32 memory totalB = encryptedTotalForOptionB[batchId];
        _requireInitialized(totalA);
        _requireInitialized(totalB);

        bytes32[] memory currentCts = new bytes32[](2);
        currentCts[0] = FHE.toBytes32(totalA);
        currentCts[1] = FHE.toBytes32(totalB);
        bytes32 currentHash = _hashCiphertexts(currentCts);

        if (currentHash != ctx.stateHash) {
            revert StateMismatch();
        }
        // Security: State hash verification ensures that the ciphertexts being decrypted are exactly
        // the same as when the decryption was requested, preventing manipulation of contract state
        // between request and callback.

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) {
            revert InvalidProof();
        }

        (bytes32 clearTotalABytes, bytes32 clearTotalBBytes) = abi.decode(cleartexts, (bytes32, bytes32));
        uint32 clearA = uint32(uint256(clearTotalABytes));
        uint32 clearB = uint32(uint256(clearTotalBBytes));

        clearTotalForOptionA[batchId] = clearA;
        clearTotalForOptionB[batchId] = clearB;
        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, clearA, clearB);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded(euint32 memory x) internal {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEuint32(0);
        }
    }

    function _initIfNeeded(ebool memory x) internal {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEbool(false);
        }
    }

    function _requireInitialized(euint32 memory x) internal pure {
        if (!FHE.isInitialized(x)) {
            revert NotInitialized();
        }
    }

    function _requireInitialized(ebool memory x) internal pure {
        if (!FHE.isInitialized(x)) {
            revert NotInitialized();
        }
    }
}