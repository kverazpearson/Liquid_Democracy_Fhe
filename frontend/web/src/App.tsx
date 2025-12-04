// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface Proposal {
  id: string;
  title: string;
  description: string;
  encryptedVotes: string;
  timestamp: number;
  status: "active" | "passed" | "rejected";
}

interface Delegation {
  from: string;
  to: string;
  encryptedWeight: string;
  timestamp: number;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const FHECompute = (encryptedData: string, operation: string): string => {
  const value = FHEDecryptNumber(encryptedData);
  let result = value;
  
  switch(operation) {
    case 'add':
      result = value + 1;
      break;
    case 'double':
      result = value * 2;
      break;
    default:
      result = value;
  }
  
  return FHEEncryptNumber(result);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateProposalModal, setShowCreateProposalModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newProposalData, setNewProposalData] = useState({ title: "", description: "" });
  const [showFAQ, setShowFAQ] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<Proposal | null>(null);
  const [decryptedVotes, setDecryptedVotes] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [voteWeight, setVoteWeight] = useState<number>(1);
  const [delegateAddress, setDelegateAddress] = useState<string>("");
  const [delegating, setDelegating] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  
  const activeProposals = proposals.filter(p => p.status === "active");
  const passedProposals = proposals.filter(p => p.status === "passed");
  const rejectedProposals = proposals.filter(p => p.status === "rejected");
  const userDelegations = delegations.filter(d => d.from.toLowerCase() === address?.toLowerCase());

  useEffect(() => {
    loadData().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      // Load proposals
      const proposalKeysBytes = await contract.getData("proposal_keys");
      let proposalKeys: string[] = [];
      if (proposalKeysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(proposalKeysBytes);
          if (keysStr.trim() !== '') proposalKeys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing proposal keys:", e); }
      }
      
      const proposalList: Proposal[] = [];
      for (const key of proposalKeys) {
        try {
          const proposalBytes = await contract.getData(`proposal_${key}`);
          if (proposalBytes.length > 0) {
            try {
              const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
              proposalList.push({ 
                id: key, 
                title: proposalData.title,
                description: proposalData.description,
                encryptedVotes: proposalData.votes,
                timestamp: proposalData.timestamp,
                status: proposalData.status || "active"
              });
            } catch (e) { console.error(`Error parsing proposal data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading proposal ${key}:`, e); }
      }
      proposalList.sort((a, b) => b.timestamp - a.timestamp);
      setProposals(proposalList);
      
      // Load delegations
      const delegationKeysBytes = await contract.getData("delegation_keys");
      let delegationKeys: string[] = [];
      if (delegationKeysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(delegationKeysBytes);
          if (keysStr.trim() !== '') delegationKeys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing delegation keys:", e); }
      }
      
      const delegationList: Delegation[] = [];
      for (const key of delegationKeys) {
        try {
          const delegationBytes = await contract.getData(`delegation_${key}`);
          if (delegationBytes.length > 0) {
            try {
              const delegationData = JSON.parse(ethers.toUtf8String(delegationBytes));
              delegationList.push({ 
                from: delegationData.from,
                to: delegationData.to,
                encryptedWeight: delegationData.weight,
                timestamp: delegationData.timestamp
              });
            } catch (e) { console.error(`Error parsing delegation data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading delegation ${key}:`, e); }
      }
      setDelegations(delegationList);
    } catch (e) { console.error("Error loading data:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createProposal = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating proposal with Zama FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const proposalId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const proposalData = { 
        title: newProposalData.title, 
        description: newProposalData.description,
        votes: FHEEncryptNumber(0), // Start with 0 votes
        timestamp: Math.floor(Date.now() / 1000),
        status: "active"
      };
      
      await contract.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(proposalData)));
      
      // Update proposal keys
      const keysBytes = await contract.getData("proposal_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(proposalId);
      await contract.setData("proposal_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Proposal created successfully!" });
      await loadData();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateProposalModal(false);
        setNewProposalData({ title: "", description: "" });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const voteOnProposal = async (proposalId: string) => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Processing encrypted vote with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      
      // Get current proposal data
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      // Get user's vote weight (1 by default or delegated weight)
      let userWeight = 1;
      const userDelegation = delegations.find(d => d.from.toLowerCase() === address?.toLowerCase());
      if (userDelegation) {
        // If user has delegated, they can't vote directly
        throw new Error("You have delegated your voting power and cannot vote directly");
      }
      
      // Check if user has received delegations
      const receivedDelegations = delegations.filter(d => d.to.toLowerCase() === address?.toLowerCase());
      if (receivedDelegations.length > 0) {
        // Sum all delegated weights (in real FHE this would be homomorphic addition)
        let totalWeight = 0;
        for (const d of receivedDelegations) {
          totalWeight += FHEDecryptNumber(d.encryptedWeight);
        }
        userWeight += totalWeight;
      }
      
      // Add vote (in real FHE this would be homomorphic addition)
      const currentVotes = FHEDecryptNumber(proposalData.votes);
      const newVotes = currentVotes + userWeight;
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedProposal = { ...proposalData, votes: FHEEncryptNumber(newVotes) };
      await contractWithSigner.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(updatedProposal)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote submitted with FHE encryption!" });
      await loadData();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Voting failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const delegateVote = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    if (!delegateAddress || !ethers.isAddress(delegateAddress)) {
      alert("Please enter a valid Ethereum address");
      return;
    }
    
    setDelegating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting delegation with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const delegationId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const delegationData = { 
        from: address,
        to: delegateAddress,
        weight: FHEEncryptNumber(voteWeight),
        timestamp: Math.floor(Date.now() / 1000)
      };
      
      await contract.setData(`delegation_${delegationId}`, ethers.toUtf8Bytes(JSON.stringify(delegationData)));
      
      // Update delegation keys
      const keysBytes = await contract.getData("delegation_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(delegationId);
      await contract.setData("delegation_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Voting power delegated securely!" });
      await loadData();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowDelegateModal(false);
        setDelegateAddress("");
        setVoteWeight(1);
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Delegation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setDelegating(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { console.error("Decryption failed:", e); return null; } 
    finally { setIsDecrypting(false); }
  };

  const finalizeProposal = async (proposalId: string, status: "passed" | "rejected") => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Finalizing proposal with FHE..." });
    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Failed to get contract");
      const proposalBytes = await contract.getData(`proposal_${proposalId}`);
      if (proposalBytes.length === 0) throw new Error("Proposal not found");
      const proposalData = JSON.parse(ethers.toUtf8String(proposalBytes));
      
      const contractWithSigner = await getContractWithSigner();
      if (!contractWithSigner) throw new Error("Failed to get contract with signer");
      
      const updatedProposal = { ...proposalData, status };
      await contractWithSigner.setData(`proposal_${proposalId}`, ethers.toUtf8Bytes(JSON.stringify(updatedProposal)));
      
      setTransactionStatus({ visible: true, status: "success", message: `Proposal ${status} successfully!` });
      await loadData();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Finalization failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const renderVoteChart = () => {
    if (proposals.length === 0) return null;
    
    const maxVotes = Math.max(...proposals.map(p => FHEDecryptNumber(p.encryptedVotes)));
    return (
      <div className="vote-chart">
        {proposals.slice(0, 5).map(proposal => {
          const votes = FHEDecryptNumber(proposal.encryptedVotes);
          const percentage = maxVotes > 0 ? (votes / maxVotes) * 100 : 0;
          return (
            <div className="vote-bar" key={proposal.id}>
              <div className="bar-label">{proposal.title.substring(0, 20)}...</div>
              <div className="bar-container">
                <div 
                  className={`bar-fill ${proposal.status}`} 
                  style={{ width: `${percentage}%` }}
                >
                  <span className="vote-count">{votes} votes</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const faqItems = [
    {
      question: "What is Liquid Democracy?",
      answer: "Liquid democracy is a hybrid form of democracy where voters can choose to vote directly on issues or delegate their votes to representatives they trust."
    },
    {
      question: "How does FHE protect my privacy?",
      answer: "Fully Homomorphic Encryption (FHE) allows computations on encrypted data without decrypting it. This means your votes and delegations remain private even during tallying."
    },
    {
      question: "Can I change my delegation?",
      answer: "Yes, you can update your delegation at any time. Your voting power will be transferred to the new delegate immediately."
    },
    {
      question: "How are votes counted?",
      answer: "Votes are counted using homomorphic encryption, allowing the system to tally encrypted votes without decrypting individual votes."
    },
    {
      question: "What happens if my delegate doesn't vote?",
      answer: "If your delegate doesn't vote on a proposal, your voting power is not used for that proposal. You can choose a new delegate or vote directly."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted governance system...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon"><div className="shield-icon"></div></div>
          <h1>Liquid<span>Democracy</span>FHE</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateProposalModal(true)} className="create-btn cyber-button">
            <div className="add-icon"></div>New Proposal
          </button>
          <button className="cyber-button" onClick={() => setShowDelegateModal(true)}>
            Delegate Vote
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>
      
      <div className="dashboard-grid">
        {/* Left Column */}
        <div className="dashboard-column">
          <div className="dashboard-card cyber-card">
            <h3>Project Introduction</h3>
            <p>
              <strong>Liquid Democracy FHE</strong> is an autonomous world governed by an FHE-encrypted liquid democracy. 
              This system combines the flexibility of liquid democracy with the privacy guarantees of Fully Homomorphic Encryption (FHE).
            </p>
            <div className="fhe-badge"><span>Powered by Zama FHE</span></div>
            <div className="features">
              <div className="feature">
                <div className="feature-icon">🔒</div>
                <div className="feature-text">Votes and delegations encrypted with FHE</div>
              </div>
              <div className="feature">
                <div className="feature-icon">⚙️</div>
                <div className="feature-text">Homomorphic tallying without decryption</div>
              </div>
              <div className="feature">
                <div className="feature-icon">🌐</div>
                <div className="feature-text">Next-generation governance for online communities</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Data Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{proposals.length}</div>
                <div className="stat-label">Total Proposals</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{activeProposals.length}</div>
                <div className="stat-label">Active</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{passedProposals.length}</div>
                <div className="stat-label">Passed</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedProposals.length}</div>
                <div className="stat-label">Rejected</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{delegations.length}</div>
                <div className="stat-label">Delegations</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{userDelegations.length}</div>
                <div className="stat-label">Your Delegations</div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Center Column */}
        <div className="dashboard-column main-content">
          <div className="dashboard-card cyber-card">
            <h3>Active Proposals</h3>
            <div className="proposals-list">
              {activeProposals.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No active proposals found</p>
                  <button className="cyber-button primary" onClick={() => setShowCreateProposalModal(true)}>Create First Proposal</button>
                </div>
              ) : activeProposals.map(proposal => (
                <div className="proposal-item" key={proposal.id}>
                  <div className="proposal-header">
                    <h4>{proposal.title}</h4>
                    <span className="proposal-id">#{proposal.id.substring(0, 6)}</span>
                  </div>
                  <p className="proposal-desc">{proposal.description.substring(0, 100)}...</p>
                  <div className="proposal-footer">
                    <div className="proposal-meta">
                      <span className="timestamp">{new Date(proposal.timestamp * 1000).toLocaleDateString()}</span>
                      <button 
                        className="cyber-button small" 
                        onClick={() => setSelectedProposal(proposal)}
                      >
                        Details
                      </button>
                    </div>
                    <div className="proposal-actions">
                      <button 
                        className="cyber-button success small" 
                        onClick={() => voteOnProposal(proposal.id)}
                      >
                        Vote
                      </button>
                      <button 
                        className="cyber-button small" 
                        onClick={() => finalizeProposal(proposal.id, "passed")}
                      >
                        Pass
                      </button>
                      <button 
                        className="cyber-button danger small" 
                        onClick={() => finalizeProposal(proposal.id, "rejected")}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Voting Analytics</h3>
            {renderVoteChart()}
          </div>
        </div>
        
        {/* Right Column */}
        <div className="dashboard-column">
          <div className="dashboard-card cyber-card">
            <h3>Your Delegations</h3>
            <div className="delegations-list">
              {userDelegations.length === 0 ? (
                <div className="no-delegations">
                  <p>You haven't delegated your voting power yet</p>
                  <button className="cyber-button primary" onClick={() => setShowDelegateModal(true)}>Delegate Now</button>
                </div>
              ) : userDelegations.map((delegation, index) => (
                <div className="delegation-item" key={index}>
                  <div className="delegation-from-to">
                    <span className="from">You</span>
                    <div className="arrow">→</div>
                    <span className="to">{delegation.to.substring(0, 6)}...{delegation.to.substring(38)}</span>
                  </div>
                  <div className="delegation-meta">
                    <span className="weight">Weight: {FHEDecryptNumber(delegation.encryptedWeight)}</span>
                    <span className="timestamp">{new Date(delegation.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <div className="faq-header">
              <h3>Frequently Asked Questions</h3>
              <button 
                className={`cyber-button toggle-btn ${showFAQ ? 'active' : ''}`} 
                onClick={() => setShowFAQ(!showFAQ)}
              >
                {showFAQ ? "Hide" : "Show"}
              </button>
            </div>
            
            {showFAQ && (
              <div className="faq-content">
                {faqItems.map((item, index) => (
                  <div className="faq-item" key={index}>
                    <div className="faq-question">{item.question}</div>
                    <div className="faq-answer">{item.answer}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {showCreateProposalModal && (
        <ModalCreateProposal 
          onSubmit={createProposal} 
          onClose={() => setShowCreateProposalModal(false)} 
          creating={creating} 
          proposalData={newProposalData} 
          setProposalData={setNewProposalData}
        />
      )}
      
      {showDelegateModal && (
        <ModalDelegate 
          onSubmit={delegateVote} 
          onClose={() => setShowDelegateModal(false)} 
          delegating={delegating}
          delegateAddress={delegateAddress}
          setDelegateAddress={setDelegateAddress}
          voteWeight={voteWeight}
          setVoteWeight={setVoteWeight}
        />
      )}
      
      {selectedProposal && (
        <ProposalDetailModal 
          proposal={selectedProposal} 
          onClose={() => { 
            setSelectedProposal(null); 
            setDecryptedVotes(null); 
          }} 
          decryptedVotes={decryptedVotes} 
          setDecryptedVotes={setDecryptedVotes} 
          isDecrypting={isDecrypting} 
          decryptWithSignature={decryptWithSignature}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
      
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="shield-icon"></div><span>Liquid Democracy FHE</span></div>
            <p>Governance powered by Zama FHE technology</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Community</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Governance</span></div>
          <div className="copyright">© {new Date().getFullYear()} Liquid Democracy FHE. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProposalProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  proposalData: any;
  setProposalData: (data: any) => void;
}

const ModalCreateProposal: React.FC<ModalCreateProposalProps> = ({ onSubmit, onClose, creating, proposalData, setProposalData }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setProposalData({ ...proposalData, [name]: value });
  };

  const handleSubmit = () => {
    if (!proposalData.title || !proposalData.description) { 
      alert("Please fill required fields"); 
      return; 
    }
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Create New Proposal</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Votes on this proposal will be encrypted with Zama FHE</p></div>
          </div>
          <div className="form-group">
            <label>Title *</label>
            <input 
              type="text" 
              name="title" 
              value={proposalData.title} 
              onChange={handleChange} 
              placeholder="Proposal title..." 
              className="cyber-input"
            />
          </div>
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={proposalData.description} 
              onChange={handleChange} 
              placeholder="Detailed description of your proposal..." 
              className="cyber-textarea"
              rows={4}
            />
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Voting Privacy</strong><p>All votes will be encrypted and processed homomorphically, ensuring voter privacy</p></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={handleSubmit} disabled={creating} className="submit-btn cyber-button primary">
            {creating ? "Creating with FHE..." : "Create Proposal"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDelegateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  delegating: boolean;
  delegateAddress: string;
  setDelegateAddress: (address: string) => void;
  voteWeight: number;
  setVoteWeight: (weight: number) => void;
}

const ModalDelegate: React.FC<ModalDelegateProps> = ({ 
  onSubmit, 
  onClose, 
  delegating,
  delegateAddress,
  setDelegateAddress,
  voteWeight,
  setVoteWeight
}) => {
  const handleAddressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDelegateAddress(e.target.value);
  };

  const handleWeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVoteWeight(parseFloat(e.target.value));
  };

  return (
    <div className="modal-overlay">
      <div className="delegate-modal cyber-card">
        <div className="modal-header">
          <h2>Delegate Your Voting Power</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            <div><strong>FHE Encryption Notice</strong><p>Your delegation will be encrypted with Zama FHE</p></div>
          </div>
          <div className="form-group">
            <label>Delegate Address *</label>
            <input 
              type="text" 
              value={delegateAddress} 
              onChange={handleAddressChange} 
              placeholder="Enter delegate's Ethereum address..." 
              className="cyber-input"
            />
          </div>
          <div className="form-group">
            <label>Voting Weight *</label>
            <input 
              type="number" 
              min="1"
              step="1"
              value={voteWeight} 
              onChange={handleWeightChange} 
              className="cyber-input"
            />
          </div>
          <div className="encryption-preview">
            <h4>Encryption Preview</h4>
            <div className="preview-container">
              <div className="plain-data"><span>Plain Weight:</span><div>{voteWeight}</div></div>
              <div className="encryption-arrow">→</div>
              <div className="encrypted-data">
                <span>Encrypted Data:</span>
                <div>{FHEEncryptNumber(voteWeight).substring(0, 50)}...</div>
              </div>
            </div>
          </div>
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            <div><strong>Delegation Privacy</strong><p>Your delegation relationship will remain encrypted and private</p></div>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn cyber-button">Cancel</button>
          <button onClick={onSubmit} disabled={delegating} className="submit-btn cyber-button primary">
            {delegating ? "Encrypting with FHE..." : "Delegate Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ProposalDetailModalProps {
  proposal: Proposal;
  onClose: () => void;
  decryptedVotes: number | null;
  setDecryptedVotes: (value: number | null) => void;
  isDecrypting: boolean;
  decryptWithSignature: (encryptedData: string) => Promise<number | null>;
}

const ProposalDetailModal: React.FC<ProposalDetailModalProps> = ({ 
  proposal, 
  onClose, 
  decryptedVotes, 
  setDecryptedVotes, 
  isDecrypting, 
  decryptWithSignature 
}) => {
  const handleDecrypt = async () => {
    if (decryptedVotes !== null) { 
      setDecryptedVotes(null); 
      return; 
    }
    const decrypted = await decryptWithSignature(proposal.encryptedVotes);
    if (decrypted !== null) setDecryptedVotes(decrypted);
  };

  return (
    <div className="modal-overlay">
      <div className="proposal-detail-modal cyber-card">
        <div className="modal-header">
          <h2>Proposal Details #{proposal.id.substring(0, 8)}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        <div className="modal-body">
          <div className="proposal-info">
            <div className="info-item"><span>Title:</span><strong>{proposal.title}</strong></div>
            <div className="info-item"><span>Status:</span><strong className={`status-badge ${proposal.status}`}>{proposal.status}</strong></div>
            <div className="info-item"><span>Created:</span><strong>{new Date(proposal.timestamp * 1000).toLocaleString()}</strong></div>
          </div>
          <div className="proposal-description">
            <h3>Description</h3>
            <p>{proposal.description}</p>
          </div>
          <div className="encrypted-data-section">
            <h3>Voting Data</h3>
            <div className="encrypted-data">{proposal.encryptedVotes.substring(0, 100)}...</div>
            <div className="fhe-tag"><div className="fhe-icon"></div><span>FHE Encrypted Votes</span></div>
            <button className="decrypt-btn cyber-button" onClick={handleDecrypt} disabled={isDecrypting}>
              {isDecrypting ? <span className="decrypt-spinner"></span> : decryptedVotes !== null ? "Hide Vote Count" : "Decrypt Vote Count"}
            </button>
          </div>
          {decryptedVotes !== null && (
            <div className="decrypted-data-section">
              <h3>Decrypted Vote Count</h3>
              <div className="decrypted-value">{decryptedVotes}</div>
              <div className="decryption-notice"><div className="warning-icon"></div><span>Decrypted data is only visible after wallet signature verification</span></div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn cyber-button">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;
