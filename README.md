# 🌱 Transparent Aviation Carbon Credits

Welcome to an innovative Web3 solution for addressing aviation's environmental impact! This project creates a transparent, blockchain-based system on Stacks that connects airline flights to verified urban greening projects, ensuring credible carbon credits and eliminating greenwashing in the aviation sector.

## ✨ Features

🌳 Register and verify urban greening projects on-chain  
✈️ Log flights with calculated carbon emissions  
🔗 Automatically link flights to greening projects via carbon credit tokens  
💸 Facilitate payments for credits using STX or custom tokens  
✅ Provide immutable proof of credits for audits and regulatory compliance  
📈 Queryable transparency reports for stakeholders  
🚫 Prevent double-counting of credits with unique NFTs  
🗳️ Governance for updating emission standards and project criteria  

## 🛠 How It Works

**For Airlines/Passengers**  
- Calculate flight emissions based on factors like distance and aircraft efficiency.  
- Use the FlightRegistry contract to record flight details and emissions.  
- Purchase carbon credits through the PaymentHandler contract, which mints CreditTokens and links them to a verified urban greening project.  
- Receive an NFT as proof of carbon credit for compliance and reporting.  

**For Urban Greening Providers**  
- Submit project details (e.g., location, number of trees planted, CO2 absorption estimates) to the ProjectRegistry contract.  
- Projects are verified via the VerificationOracle contract using off-chain data (e.g., urban sensor data or imagery).  
- Verified projects are eligible for matching with flights through the CreditMatcher contract.  
- Providers receive payments and can track credited offsets transparently.  

**For Verifiers/Auditors**  
- Access the Reporting contract to view flight-credit linkages and sequestration data.  
- Use verify-credit to confirm the authenticity and prevent reuse of credits.  
- Review governance logs for updates to system parameters or standards.  

This creates a transparent, end-to-end system for aviation carbon credits on the blockchain.

## 📜 Smart Contracts

Built with 8 Clarity smart contracts on the Stacks blockchain for modularity, security, and scalability:  

1. **UserRegistry.clar**: Registers airlines, passengers, and greening providers with distinct roles and permissions.  
2. **FlightRegistry.clar**: Logs flight data, including routes, emissions, and timestamps.  
3. **EmissionCalculator.clar**: Calculates emissions using flight parameters like distance and fuel type (predefined formulas).  
4. **ProjectRegistry.clar**: Stores details of urban greening projects, including CO2 absorption metrics.  
5. **VerificationOracle.clar**: Verifies greening projects using external data sources (e.g., urban imagery hashes).  
6. **CreditToken.clar**: Manages fungible carbon credit tokens (SIP-010 compliant).  
7. **CreditMatcher.clar**: Matches flights to greening projects, mints NFTs for unique linkages, and prevents double-counting.  
8. **PaymentHandler.clar**: Handles payments in STX or tokens, distributes funds to providers, and triggers credit matching.  
9. **Reporting.clar**: Offers read-only queries for transparency, including credit histories and impact summaries.  
10. **Governance.clar**: Enables decentralized updates to emission factors, verification criteria, and system rules via voting.
