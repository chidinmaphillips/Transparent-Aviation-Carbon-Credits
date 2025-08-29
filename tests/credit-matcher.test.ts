// CreditMatcher.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface MatchRecord {
  flightOwner: string;
  flightId: number;
  projectOwner: string;
  projectId: number;
  matchedAmount: number;
  nftId: number;
  timestamp: number;
  metadata: string;
  status: string;
}

interface ProjectUsage {
  usedCapacity: number;
  totalMatched: number;
}

interface GovernanceProposal {
  proposer: string;
  description: string;
  newParam: string;
  newValue: number;
  startBlock: number;
  endBlock: number;
  yesVotes: number;
  noVotes: number;
  executed: boolean;
}

interface Dispute {
  disputant: string;
  reason: string;
  resolved: boolean;
  resolution: string | null;
}

interface Collaborator {
  role: string;
  permissions: string[];
  addedAt: number;
}

interface Vote {
  vote: boolean;
  weight: number;
}

interface ContractState {
  paused: boolean;
  admin: string;
  nftContract: string;
  creditTokenContract: string;
  flightRegistryContract: string;
  projectRegistryContract: string;
  matchCounter: number;
  totalMatchedEmissions: number;
  matchingFee: number;
  matches: Map<number, MatchRecord>;
  flightMatches: Map<string, { matchId: number }>; // Key: `${flightOwner}-${flightId}`
  projectUsage: Map<string, ProjectUsage>; // Key: `${projectOwner}-${projectId}`
  governanceProposals: Map<number, GovernanceProposal>;
  votes: Map<string, Vote>; // Key: `${proposalId}-${voter}`
  disputableMatches: Map<number, Dispute>;
  collaborators: Map<string, Collaborator>; // Key: `${matchId}-${collaborator}`
}

// Mock trait implementations (stubs for dependencies)
class MockFlightRegistry {
  getFlightEmissions(flightOwner: string, flightId: number): ClarityResponse<number> {
    return { ok: true, value: 1000 }; // Stubbed emissions
  }
  markFlightOffset(flightOwner: string, flightId: number): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
}

class MockProjectRegistry {
  getProjectSequestration(projectOwner: string, projectId: number): ClarityResponse<number> {
    return { ok: true, value: 2000 };
  }
  useProjectCapacity(projectOwner: string, projectId: number, amount: number): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
  getProjectStatus(projectOwner: string, projectId: number): ClarityResponse<{ active: boolean; verified: boolean }> {
    return { ok: true, value: { active: true, verified: true } };
  }
}

class MockCreditToken {
  burn(amount: number, sender: string): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
}

class MockNft {
  mint(recipient: string, uri: string, metadata: string): ClarityResponse<number> {
    return { ok: true, value: 1 }; // Stubbed NFT ID
  }
}

// Mock contract implementation
class CreditMatcherMock {
  private state: ContractState = {
    paused: false,
    admin: "deployer",
    nftContract: "nft-contract",
    creditTokenContract: "credit-token",
    flightRegistryContract: "flight-registry",
    projectRegistryContract: "project-registry",
    matchCounter: 0,
    totalMatchedEmissions: 0,
    matchingFee: 1,
    matches: new Map(),
    flightMatches: new Map(),
    projectUsage: new Map(),
    governanceProposals: new Map(),
    votes: new Map(),
    disputableMatches: new Map(),
    collaborators: new Map(),
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_FLIGHT = 101;
  private ERR_INVALID_PROJECT = 102;
  private ERR_INSUFFICIENT_CREDITS = 103;
  private ERR_DOUBLE_COUNTING = 104;
  private ERR_INVALID_AMOUNT = 105;
  private ERR_PAUSED = 106;
  private ERR_ALREADY_MATCHED = 107;
  private ERR_PROJECT_NOT_VERIFIED = 108;
  private ERR_INVALID_METADATA = 109;
  private ERR_GOVERNANCE = 110;
  private ERR_INVALID_VOTE = 111;
  private ERR_PROPOSAL_EXPIRED = 112;
  private ERR_NOT_ADMIN = 113;
  private ERR_INVALID_PARAM = 114;
  private MAX_METADATA_LEN = 500;
  private GOVERNANCE_QUORUM = 51;
  private PROPOSAL_DURATION = 1440;

  private flightRegistry = new MockFlightRegistry();
  private projectRegistry = new MockProjectRegistry();
  private creditToken = new MockCreditToken();
  private nft = new MockNft();

  // Helper to simulate block height
  private currentBlock = 1000;

  private getBlockHeight() {
    return this.currentBlock;
  }

  private advanceBlock() {
    this.currentBlock += 1;
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_NOT_ADMIN };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  createMatch(
    caller: string,
    flightId: number,
    projectOwner: string,
    projectId: number,
    amount: number,
    metadata: string
  ): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const flightKey = `${caller}-${flightId}`;
    if (this.state.flightMatches.has(flightKey)) {
      return { ok: false, value: this.ERR_ALREADY_MATCHED };
    }
    const emissions = this.flightRegistry.getFlightEmissions(caller, flightId);
    if (!emissions.ok) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    const sequestration = this.projectRegistry.getProjectSequestration(projectOwner, projectId);
    if (!sequestration.ok) {
      return { ok: false, value: this.ERR_INVALID_PROJECT };
    }
    const status = this.projectRegistry.getProjectStatus(projectOwner, projectId);
    if (!status.ok || !status.value.active || !status.value.verified) {
      return { ok: false, value: this.ERR_PROJECT_NOT_VERIFIED };
    }
    if (amount <= 0 || amount > emissions.value || amount > sequestration.value) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_INVALID_METADATA };
    }
    const burnResult = this.creditToken.burn(amount, caller);
    if (!burnResult.ok) {
      return { ok: false, value: this.ERR_INSUFFICIENT_CREDITS };
    }
    const useCapacity = this.projectRegistry.useProjectCapacity(projectOwner, projectId, amount);
    if (!useCapacity.ok) {
      return { ok: false, value: this.ERR_INVALID_PROJECT };
    }
    const markOffset = this.flightRegistry.markFlightOffset(caller, flightId);
    if (!markOffset.ok) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    const nftId = this.nft.mint(caller, "uri-hash", metadata); // Simplified URI
    if (!nftId.ok) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const matchId = this.state.matchCounter + 1;
    this.state.matches.set(matchId, {
      flightOwner: caller,
      flightId,
      projectOwner,
      projectId,
      matchedAmount: amount,
      nftId: nftId.value,
      timestamp: this.getBlockHeight(),
      metadata,
      status: "active",
    });
    this.state.flightMatches.set(flightKey, { matchId });
    const projectKey = `${projectOwner}-${projectId}`;
    const usage = this.state.projectUsage.get(projectKey) ?? { usedCapacity: 0, totalMatched: 0 };
    usage.usedCapacity += amount;
    usage.totalMatched += amount;
    this.state.projectUsage.set(projectKey, usage);
    this.state.matchCounter = matchId;
    this.state.totalMatchedEmissions += amount;
    return { ok: true, value: matchId };
  }

  retireMatch(caller: string, matchId: number): ClarityResponse<boolean> {
    const match = this.state.matches.get(matchId);
    if (!match) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    if (match.flightOwner !== caller) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (match.status !== "active") {
      return { ok: false, value: this.ERR_ALREADY_MATCHED };
    }
    match.status = "retired";
    this.state.matches.set(matchId, match);
    return { ok: true, value: true };
  }

  disputeMatch(caller: string, matchId: number, reason: string): ClarityResponse<boolean> {
    const match = this.state.matches.get(matchId);
    if (!match) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    if (caller !== match.flightOwner && caller !== match.projectOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (this.state.disputableMatches.has(matchId)) {
      return { ok: false, value: this.ERR_ALREADY_MATCHED };
    }
    this.state.disputableMatches.set(matchId, {
      disputant: caller,
      reason,
      resolved: false,
      resolution: null,
    });
    match.status = "disputed";
    this.state.matches.set(matchId, match);
    return { ok: true, value: true };
  }

  resolveDispute(caller: string, matchId: number, resolution: string, restore: boolean): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const dispute = this.state.disputableMatches.get(matchId);
    if (!dispute || dispute.resolved) {
      return { ok: false, value: this.ERR_ALREADY_MATCHED };
    }
    dispute.resolved = true;
    dispute.resolution = resolution;
    this.state.disputableMatches.set(matchId, dispute);
    const match = this.state.matches.get(matchId)!;
    match.status = restore ? "active" : "retired";
    this.state.matches.set(matchId, match);
    return { ok: true, value: true };
  }

  createGovernanceProposal(caller: string, description: string, param: string, value: number): ClarityResponse<number> {
    if (description.length === 0) {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    const proposalId = this.state.matchCounter + 1; // Reusing counter
    this.state.governanceProposals.set(proposalId, {
      proposer: caller,
      description,
      newParam: param,
      newValue: value,
      startBlock: this.getBlockHeight(),
      endBlock: this.getBlockHeight() + this.PROPOSAL_DURATION,
      yesVotes: 0,
      noVotes: 0,
      executed: false,
    });
    return { ok: true, value: proposalId };
  }

  voteOnProposal(caller: string, proposalId: number, vote: boolean, weight: number): ClarityResponse<boolean> {
    const proposal = this.state.governanceProposals.get(proposalId);
    if (!proposal) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    if (this.getBlockHeight() < proposal.startBlock || this.getBlockHeight() >= proposal.endBlock) {
      return { ok: false, value: this.ERR_PROPOSAL_EXPIRED };
    }
    const voteKey = `${proposalId}-${caller}`;
    if (this.state.votes.has(voteKey)) {
      return { ok: false, value: this.ERR_ALREADY_MATCHED };
    }
    if (weight <= 0) {
      return { ok: false, value: this.ERR_INVALID_VOTE };
    }
    this.state.votes.set(voteKey, { vote, weight });
    if (vote) {
      proposal.yesVotes += weight;
    } else {
      proposal.noVotes += weight;
    }
    this.state.governanceProposals.set(proposalId, proposal);
    return { ok: true, value: true };
  }

  executeProposal(caller: string, proposalId: number): ClarityResponse<boolean> {
    const proposal = this.state.governanceProposals.get(proposalId);
    if (!proposal) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    if (this.getBlockHeight() < proposal.endBlock || proposal.executed) {
      return { ok: false, value: this.ERR_PROPOSAL_EXPIRED };
    }
    const totalVotes = proposal.yesVotes + proposal.noVotes;
    if (proposal.yesVotes <= proposal.noVotes || (proposal.yesVotes * 100 / totalVotes) < this.GOVERNANCE_QUORUM) {
      return { ok: false, value: this.ERR_GOVERNANCE };
    }
    if (proposal.newParam === "matching-fee") {
      this.state.matchingFee = proposal.newValue;
    } else {
      return { ok: false, value: this.ERR_INVALID_PARAM };
    }
    proposal.executed = true;
    this.state.governanceProposals.set(proposalId, proposal);
    return { ok: true, value: true };
  }

  addCollaboratorToMatch(caller: string, matchId: number, collaborator: string, role: string, permissions: string[]): ClarityResponse<boolean> {
    const match = this.state.matches.get(matchId);
    if (!match) {
      return { ok: false, value: this.ERR_INVALID_FLIGHT };
    }
    if (caller !== match.flightOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const collabKey = `${matchId}-${collaborator}`;
    this.state.collaborators.set(collabKey, { role, permissions, addedAt: this.getBlockHeight() });
    return { ok: true, value: true };
  }

  getMatchDetails(matchId: number): ClarityResponse<MatchRecord | undefined> {
    return { ok: true, value: this.state.matches.get(matchId) };
  }

  getTotalMatchedEmissions(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalMatchedEmissions };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  user1: "wallet_1",
  user2: "wallet_2",
  projectOwner: "project_owner",
};

describe("CreditMatcher Contract", () => {
  let contract: CreditMatcherMock;

  beforeEach(() => {
    contract = new CreditMatcherMock();
    vi.resetAllMocks();
  });

  it("should allow admin to pause and unpause the contract", () => {
    const pauseResult = contract.pauseContract(accounts.deployer);
    expect(pauseResult).toEqual({ ok: true, value: true });

    const createDuringPause = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Test metadata"
    );
    expect(createDuringPause).toEqual({ ok: false, value: 106 });

    const unpauseResult = contract.unpauseContract(accounts.deployer);
    expect(unpauseResult).toEqual({ ok: true, value: true });
  });

  it("should create a match successfully", () => {
    const result = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Valid metadata"
    );
    expect(result.ok).toBe(true);
    const matchId = result.value as number;
    const details = contract.getMatchDetails(matchId);
    expect(details.value).toEqual(expect.objectContaining({
      flightOwner: accounts.user1,
      matchedAmount: 500,
      status: "active",
    }));
    expect(contract.getTotalMatchedEmissions()).toEqual({ ok: true, value: 500 });
  });

  it("should prevent creating match with invalid amount", () => {
    const result = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      0,
      "Metadata"
    );
    expect(result).toEqual({ ok: false, value: 105 });
  });

  it("should prevent double matching the same flight", () => {
    contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "First"
    );
    const second = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      2,
      300,
      "Second"
    );
    expect(second).toEqual({ ok: false, value: 107 });
  });

  it("should allow retiring a match", () => {
    const create = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Metadata"
    );
    const matchId = create.value as number;
    const retire = contract.retireMatch(accounts.user1, matchId);
    expect(retire).toEqual({ ok: true, value: true });
    const details = contract.getMatchDetails(matchId);
    expect(details.value?.status).toBe("retired");
  });

  it("should allow disputing and resolving a match", () => {
    const create = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Metadata"
    );
    const matchId = create.value as number;
    const dispute = contract.disputeMatch(accounts.user1, matchId, "Invalid data");
    expect(dispute).toEqual({ ok: true, value: true });
    const details = contract.getMatchDetails(matchId);
    expect(details.value?.status).toBe("disputed");

    const resolve = contract.resolveDispute(accounts.deployer, matchId, "Resolved valid", true);
    expect(resolve).toEqual({ ok: true, value: true });
    const updatedDetails = contract.getMatchDetails(matchId);
    expect(updatedDetails.value?.status).toBe("active");
  });

  it("should handle governance proposals", () => {
    const createProp = contract.createGovernanceProposal(
      accounts.user1,
      "Change fee",
      "matching-fee",
      2
    );
    expect(createProp.ok).toBe(true);
    const proposalId = createProp.value as number;

    const voteYes = contract.voteOnProposal(accounts.user1, proposalId, true, 60);
    expect(voteYes).toEqual({ ok: true, value: true });

    const voteNo = contract.voteOnProposal(accounts.user2, proposalId, false, 40);
    expect(voteNo).toEqual({ ok: true, value: true });

    // Advance blocks to end
    for (let i = 0; i < 1441; i++) {
      contract["advanceBlock"](); // Access private method for testing
    }

    const execute = contract.executeProposal(accounts.user1, proposalId);
    expect(execute).toEqual({ ok: true, value: true });
    expect(contract["state"].matchingFee).toBe(2); // Access state for verification
  });

  it("should add collaborator to match", () => {
    const create = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Metadata"
    );
    const matchId = create.value as number;
    const addCollab = contract.addCollaboratorToMatch(
      accounts.user1,
      matchId,
      accounts.user2,
      "Reviewer",
      ["view", "comment"]
    );
    expect(addCollab).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from resolving dispute", () => {
    const create = contract.createMatch(
      accounts.user1,
      1,
      accounts.projectOwner,
      1,
      500,
      "Metadata"
    );
    const matchId = create.value as number;
    contract.disputeMatch(accounts.user1, matchId, "Issue");
    const resolve = contract.resolveDispute(accounts.user2, matchId, "Invalid", false);
    expect(resolve).toEqual({ ok: false, value: 100 });
  });

  it("should reject proposal execution if quorum not met", () => {
    const createProp = contract.createGovernanceProposal(
      accounts.user1,
      "Change fee",
      "matching-fee",
      3
    );
    const proposalId = createProp.value as number;

    contract.voteOnProposal(accounts.user1, proposalId, true, 40);
    contract.voteOnProposal(accounts.user2, proposalId, false, 60);

    for (let i = 0; i < 1441; i++) {
      contract["advanceBlock"]();
    }

    const execute = contract.executeProposal(accounts.user1, proposalId);
    expect(execute).toEqual({ ok: false, value: 110 });
  });

  it("should prevent voting after proposal expired", () => {
    const createProp = contract.createGovernanceProposal(
      accounts.user1,
      "Test",
      "matching-fee",
      1
    );
    const proposalId = createProp.value as number;

    for (let i = 0; i < 1441; i++) {
      contract["advanceBlock"]();
    }

    const vote = contract.voteOnProposal(accounts.user1, proposalId, true, 50);
    expect(vote).toEqual({ ok: false, value: 112 });
  });
});