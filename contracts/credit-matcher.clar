;; CreditMatcher.clar
;; Core contract for matching aviation flights to urban greening projects, minting unique NFT proofs,
;; and ensuring no double-counting of carbon credits. Integrates with other system contracts via traits.

;; Traits for dependencies
(define-trait flight-registry-trait
  (
    (get-flight-emissions (principal uint) (response uint uint))
    (mark-flight-offset (principal uint) (response bool uint))
  )
)

(define-trait project-registry-trait
  (
    (get-project-sequestration (principal uint) (response uint uint))
    (use-project-capacity (principal uint uint) (response bool uint))
    (get-project-status (principal uint) (response (tuple (active bool) (verified bool)) uint))
  )
)

(define-trait credit-token-trait
  (
    ;; Assuming SIP-010 like interface
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (burn (uint principal) (response bool uint))
    (get-balance (principal) (response uint uint))
  )
)

(define-trait nft-trait
  (
    ;; Basic SIP-009 like for minting unique proofs
    (mint (principal (buff 32) (string-utf8 256)) (response uint uint))
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  )
)

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-FLIGHT u101)
(define-constant ERR-INVALID-PROJECT u102)
(define-constant ERR-INSUFFICIENT-CREDITS u103)
(define-constant ERR-DOUBLE-COUNTING u104)
(define-constant ERR-INVALID-AMOUNT u105)
(define-constant ERR-PAUSED u106)
(define-constant ERR-ALREADY-MATCHED u107)
(define-constant ERR-PROJECT-NOT-VERIFIED u108)
(define-constant ERR-INVALID-METADATA u109)
(define-constant ERR-GOVERNANCE u110)
(define-constant ERR-INVALID-VOTE u111)
(define-constant ERR-PROPOSAL-EXPIRED u112)
(define-constant ERR-NOT-ADMIN u113)
(define-constant ERR-INVALID-PARAM u114)
(define-constant MAX-METADATA-LEN u500)
(define-constant GOVERNANCE-QUORUM u51) ;; 51% for simplicity
(define-constant PROPOSAL-DURATION u1440) ;; ~10 days in blocks

;; Data Variables
(define-data-var contract-paused bool false)
(define-data-var admin principal tx-sender)
(define-data-var nft-contract principal tx-sender) ;; To be set to actual NFT contract
(define-data-var credit-token-contract principal tx-sender)
(define-data-var flight-registry-contract principal tx-sender)
(define-data-var project-registry-contract principal tx-sender)
(define-data-var match-counter uint u0)
(define-data-var total-matched-emissions uint u0)
(define-data-var matching-fee uint u1) ;; In percentage points, e.g., 1%

;; Data Maps
(define-map matches
  { match-id: uint }
  {
    flight-owner: principal,
    flight-id: uint,
    project-owner: principal,
    project-id: uint,
    matched-amount: uint, ;; CO2 in tons or units
    nft-id: uint,
    timestamp: uint,
    metadata: (string-utf8 256),
    status: (string-utf8 20) ;; "active", "retired", "disputed"
  }
)

(define-map flight-matches
  { flight-owner: principal, flight-id: uint }
  { match-id: uint }
)

(define-map project-usage
  { project-owner: principal, project-id: uint }
  { used-capacity: uint, total-matched: uint }
)

(define-map governance-proposals
  { proposal-id: uint }
  {
    proposer: principal,
    description: (string-utf8 500),
    new-param: (string-utf8 50), ;; e.g., "matching-fee"
    new-value: uint,
    start-block: uint,
    end-block: uint,
    yes-votes: uint,
    no-votes: uint,
    executed: bool
  }
)

(define-map votes
  { proposal-id: uint, voter: principal }
  { vote: bool, weight: uint } ;; true for yes
)

(define-map disputable-matches
  { match-id: uint }
  {
    disputant: principal,
    reason: (string-utf8 200),
    resolved: bool,
    resolution: (optional (string-utf8 100))
  }
)

(define-map collaborators
  { match-id: uint, collaborator: principal }
  {
    role: (string-utf8 50),
    permissions: (list 5 (string-utf8 20)),
    added-at: uint
  }
)

;; Private Functions
(define-private (is-admin (caller principal))
  (is-eq caller (var-get admin))
)

(define-private (is-paused)
  (var-get contract-paused)
)

(define-private (validate-metadata (metadata (string-utf8 256)))
  (if (> (len metadata) MAX-METADATA-LEN)
    (err ERR-INVALID-METADATA)
    (ok true)
  )
)

(define-private (burn-credits (amount uint) (sender principal))
  (contract-call? (var-get credit-token-contract) burn amount sender)
)

(define-private (get-flight-emissions (flight-owner principal) (flight-id uint))
  (contract-call? (var-get flight-registry-contract) get-flight-emissions flight-owner flight-id)
)

(define-private (get-project-sequestration (project-owner principal) (project-id uint))
  (contract-call? (var-get project-registry-contract) get-project-sequestration project-owner project-id)
)

(define-private (use-project-capacity (project-owner principal) (project-id uint) (amount uint))
  (contract-call? (var-get project-registry-contract) use-project-capacity project-owner project-id amount)
)

(define-private (mark-flight-offset (flight-owner principal) (flight-id uint))
  (contract-call? (var-get flight-registry-contract) mark-flight-offset flight-owner flight-id)
)

(define-private (mint-nft (recipient principal) (uri (buff 32)) (metadata (string-utf8 256)))
  (contract-call? (var-get nft-contract) mint recipient uri metadata)
)

(define-private (check-project-status (project-owner principal) (project-id uint))
  (let ((status (unwrap! (contract-call? (var-get project-registry-contract) get-project-status project-owner project-id) (err ERR-INVALID-PROJECT))))
    (if (and (get active status) (get verified status))
      (ok true)
      (err ERR-PROJECT-NOT-VERIFIED)
    )
  )
)

;; Public Functions
(define-public (set-admin (new-admin principal))
  (if (is-admin tx-sender)
    (begin
      (var-set admin new-admin)
      (ok true)
    )
    (err ERR-NOT-ADMIN)
  )
)

(define-public (pause-contract)
  (if (is-admin tx-sender)
    (begin
      (var-set contract-paused true)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (unpause-contract)
  (if (is-admin tx-sender)
    (begin
      (var-set contract-paused false)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-nft-contract (new-contract principal))
  (if (is-admin tx-sender)
    (begin
      (var-set nft-contract new-contract)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-credit-token-contract (new-contract principal))
  (if (is-admin tx-sender)
    (begin
      (var-set credit-token-contract new-contract)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-flight-registry-contract (new-contract principal))
  (if (is-admin tx-sender)
    (begin
      (var-set flight-registry-contract new-contract)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (set-project-registry-contract (new-contract principal))
  (if (is-admin tx-sender)
    (begin
      (var-set project-registry-contract new-contract)
      (ok true)
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (create-match (flight-id uint) (project-owner principal) (project-id uint) (amount uint) (metadata (string-utf8 256)))
  (let
    (
      (flight-owner tx-sender)
      (match-id (+ (var-get match-counter) u1))
      (emissions (unwrap! (get-flight-emissions flight-owner flight-id) (err ERR-INVALID-FLIGHT)))
      (sequestration (unwrap! (get-project-sequestration project-owner project-id) (err ERR-INVALID-PROJECT)))
      (existing-match (map-get? flight-matches {flight-owner: flight-owner, flight-id: flight-id}))
    )
    (if (is-paused)
      (err ERR-PAUSED)
      (if (is-some existing-match)
        (err ERR-ALREADY-MATCHED)
        (try! (check-project-status project-owner project-id))
        (if (or (<= amount u0) (> amount emissions) (> amount sequestration))
          (err ERR-INVALID-AMOUNT)
          (try! (validate-metadata metadata))
          (try! (burn-credits amount tx-sender)) ;; Burn credits to retire them
          (try! (use-project-capacity project-owner project-id amount))
          (try! (mark-flight-offset flight-owner flight-id))
          (let ((nft-id (unwrap! (mint-nft tx-sender (keccak256 (concat (to-consensus-buff? match-id) (to-consensus-buff? amount))) metadata) (err ERR-UNAUTHORIZED))))
            (map-set matches
              {match-id: match-id}
              {
                flight-owner: flight-owner,
                flight-id: flight-id,
                project-owner: project-owner,
                project-id: project-id,
                matched-amount: amount,
                nft-id: nft-id,
                timestamp: block-height,
                metadata: metadata,
                status: "active"
              }
            )
            (map-set flight-matches {flight-owner: flight-owner, flight-id: flight-id} {match-id: match-id})
            (map-set project-usage {project-owner: project-owner, project-id: project-id}
              (merge
                (default-to {used-capacity: u0, total-matched: u0} (map-get? project-usage {project-owner: project-owner, project-id: project-id}))
                {used-capacity: (+ (get used-capacity it) amount), total-matched: (+ (get total-matched it) amount)}
              )
            )
            (var-set match-counter match-id)
            (var-set total-matched-emissions (+ (var-get total-matched-emissions) amount))
            (print {event: "match-created", match-id: match-id, amount: amount})
            (ok match-id)
          )
        )
      )
    )
  )
)

(define-public (retire-match (match-id uint))
  (let ((match (unwrap! (map-get? matches {match-id: match-id}) (err ERR-INVALID-FLIGHT))))
    (if (is-eq (get flight-owner match) tx-sender)
      (if (is-eq (get status match) "active")
        (begin
          (map-set matches {match-id: match-id} (merge match {status: "retired"}))
          (print {event: "match-retired", match-id: match-id})
          (ok true)
        )
        (err ERR-ALREADY-MATCHED)
      )
      (err ERR-UNAUTHORIZED)
    )
  )
)

(define-public (dispute-match (match-id uint) (reason (string-utf8 200)))
  (let ((match (unwrap! (map-get? matches {match-id: match-id}) (err ERR-INVALID-FLIGHT))))
    (if (or (is-eq tx-sender (get flight-owner match)) (is-eq tx-sender (get project-owner match)))
      (if (not (is-some (map-get? disputable-matches {match-id: match-id})))
        (begin
          (map-set disputable-matches {match-id: match-id}
            {disputant: tx-sender, reason: reason, resolved: false, resolution: none}
          )
          (map-set matches {match-id: match-id} (merge match {status: "disputed"}))
          (print {event: "match-disputed", match-id: match-id, reason: reason})
          (ok true)
        )
        (err ERR-ALREADY-MATCHED)
      )
      (err ERR-UNAUTHORIZED)
    )
  )
)

(define-public (resolve-dispute (match-id uint) (resolution (string-utf8 100)) (restore bool))
  (if (is-admin tx-sender)
    (let ((dispute (unwrap! (map-get? disputable-matches {match-id: match-id}) (err ERR-INVALID-FLIGHT))))
      (if (not (get resolved dispute))
        (begin
          (map-set disputable-matches {match-id: match-id} (merge dispute {resolved: true, resolution: (some resolution)}))
          (map-set matches {match-id: match-id} (merge (unwrap-panic (map-get? matches {match-id: match-id})) {status: (if restore "active" "retired")}))
          (print {event: "dispute-resolved", match-id: match-id, resolution: resolution})
          (ok true)
        )
        (err ERR-ALREADY-MATCHED)
      )
    )
    (err ERR-UNAUTHORIZED)
  )
)

(define-public (create-governance-proposal (description (string-utf8 500)) (param (string-utf8 50)) (value uint))
  (let ((proposal-id (+ (var-get match-counter) u1))) ;; Reuse counter for simplicity
    (if (> (len description) u0)
      (begin
        (map-set governance-proposals {proposal-id: proposal-id}
          {
            proposer: tx-sender,
            description: description,
            new-param: param,
            new-value: value,
            start-block: block-height,
            end-block: (+ block-height PROPOSAL-DURATION),
            yes-votes: u0,
            no-votes: u0,
            executed: false
          }
        )
        (print {event: "proposal-created", proposal-id: proposal-id})
        (ok proposal-id)
      )
      (err ERR-INVALID-PARAM)
    )
  )
)

(define-public (vote-on-proposal (proposal-id uint) (vote bool) (weight uint))
  (let ((proposal (unwrap! (map-get? governance-proposals {proposal-id: proposal-id}) (err ERR-INVALID-FLIGHT))))
    (if (and (>= block-height (get start-block proposal)) (< block-height (get end-block proposal)))
      (if (is-none (map-get? votes {proposal-id: proposal-id, voter: tx-sender}))
        (if (> weight u0)
          (begin
            (map-set votes {proposal-id: proposal-id, voter: tx-sender} {vote: vote, weight: weight})
            (map-set governance-proposals {proposal-id: proposal-id}
              (merge proposal
                (if vote
                  {yes-votes: (+ (get yes-votes proposal) weight)}
                  {no-votes: (+ (get no-votes proposal) weight)}
                )
              )
            )
            (print {event: "vote-cast", proposal-id: proposal-id, vote: vote})
            (ok true)
          )
          (err ERR-INVALID-VOTE)
        )
        (err ERR-ALREADY-MATCHED)
      )
      (err ERR-PROPOSAL-EXPIRED)
    )
  )
)

(define-public (execute-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? governance-proposals {proposal-id: proposal-id}) (err ERR-INVALID-FLIGHT))))
    (if (and (>= block-height (get end-block proposal)) (not (get executed proposal)))
      (if (and (> (get yes-votes proposal) (get no-votes proposal)) (>= (/ (* (get yes-votes proposal) u100) (+ (get yes-votes proposal) (get no-votes proposal))) GOVERNANCE-QUORUM))
        (begin
          (if (is-eq (get new-param proposal) "matching-fee")
            (var-set matching-fee (get new-value proposal))
            (err ERR-INVALID-PARAM)
          )
          (map-set governance-proposals {proposal-id: proposal-id} (merge proposal {executed: true}))
          (print {event: "proposal-executed", proposal-id: proposal-id})
          (ok true)
        )
        (err ERR-GOVERNANCE)
      )
      (err ERR-PROPOSAL-EXPIRED)
    )
  )
)

(define-public (add-collaborator-to-match (match-id uint) (collaborator principal) (role (string-utf8 50)) (permissions (list 5 (string-utf8 20))))
  (let ((match (unwrap! (map-get? matches {match-id: match-id}) (err ERR-INVALID-FLIGHT))))
    (if (is-eq tx-sender (get flight-owner match))
      (begin
        (map-set collaborators {match-id: match-id, collaborator: collaborator}
          {role: role, permissions: permissions, added-at: block-height}
        )
        (ok true)
      )
      (err ERR-UNAUTHORIZED)
    )
  )
)

;; Read-Only Functions
(define-read-only (get-match-details (match-id uint))
  (map-get? matches {match-id: match-id})
)

(define-read-only (get-flight-match (flight-owner principal) (flight-id uint))
  (map-get? flight-matches {flight-owner: flight-owner, flight-id: flight-id})
)

(define-read-only (get-project-usage (project-owner principal) (project-id uint))
  (map-get? project-usage {project-owner: project-owner, project-id: project-id})
)

(define-read-only (get-total-matched-emissions)
  (var-get total-matched-emissions)
)

(define-read-only (get-proposal (proposal-id uint))
  (map-get? governance-proposals {proposal-id: proposal-id})
)

(define-read-only (get-dispute (match-id uint))
  (map-get? disputable-matches {match-id: match-id})
)

(define-read-only (get-collaborator (match-id uint) (collaborator principal))
  (map-get? collaborators {match-id: match-id, collaborator: collaborator})
)

(define-read-only (is-contract-paused)
  (var-get contract-paused)
)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-matching-fee)
  (var-get matching-fee)
)