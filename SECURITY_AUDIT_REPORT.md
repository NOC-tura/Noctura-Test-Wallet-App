# ⚠️ SECURITY AUDIT REPORT - SENSITIVE DATA EXPOSURE

**Date**: December 25, 2025  
**Repository**: NOC-tura/Noctura-Test-Wallet-App (PUBLIC)  
**Status**: 🚨 **CRITICAL ISSUE FOUND**

---

## EXPOSED SECRETS FOUND

### 1. Helius API Key ❌
**Location**: `app/.env`  
**Exposure Level**: 🔴 CRITICAL  
**Value**: `5d57d00d-0ea2-4fe1-8d81-bc8b4aed3f18`

**Risk**:
- Helius API key exposed in repo
- Public repository = anyone can use your key
- Potential for rate limit abuse
- Possible unauthorized API calls
- Could incur unexpected charges

**Action**: 
- ✅ **IMMEDIATELY** rotate this key in Helius dashboard
- ✅ Regenerate new API key
- ✅ Remove from git history

### 2. Airdrop Authority (Keypair) ⚠️
**Location**: `app/.env`  
**Exposure Level**: 🟡 MEDIUM-HIGH  
**Value**: `55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax`

**Risk**:
- This is a **public key** (not secret), BUT...
- If the corresponding private key is exposed, anyone can drain funds
- Used for airdrop authority on testnet
- Hardcoded in app makes it appear as public information

**Action**: 
- ✅ Review if private key exists in codebase (it shouldn't)
- ✅ Only expose public keys in git
- ✅ Never commit private keys

### 3. Fee Collector Token Account ⚠️
**Location**: `app/.env`  
**Exposure Level**: 🟡 MEDIUM  
**Value**: `9m2X65ZUxX24imqkdxpTHabB3dqt7GkaJuz9H2Bg1T85`

**Risk**:
- This is a token account (PDA)
- Public account address (acceptable to expose)
- But should be derivable from code, not hardcoded

**Action**: 
- ✅ Keep as-is (public data)
- ✅ Consider deriving from program state instead

### 4. Program ID ✅
**Location**: `app/.env` & `Anchor.toml`  
**Value**: `3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz`

**Status**: SAFE (public data on testnet)

---

## REMEDIATION STEPS

### Step 1: Rotate Helius API Key (URGENT) 🚨

```bash
# 1. Go to Helius Dashboard: https://dashboard.helius.dev
# 2. Find your API key
# 3. Generate a new one
# 4. Delete the old one
# 5. Update environment variable

NEW_KEY="[new-key-from-helius]"
```

### Step 2: Create .gitignore Rules

```bash
# Add to .gitignore (if not already there):
app/.env          # Local environment (development)
app/.env.local    # Local overrides
app/.env.*.local  # Environment-specific local files
.env.production   # Production secrets

# DO COMMIT:
app/.env.example  # Template with placeholders
```

### Step 3: Remove from Git History

```bash
# Only if .env was committed to git:
git rm --cached app/.env
git commit -m "chore: remove .env from tracking"

# Optional: scrub from history (advanced):
git filter-branch --tree-filter 'rm -f app/.env' HEAD
git push origin main --force  # ONLY if absolutely necessary
```

### Step 4: Update .env.example

```env
# app/.env.example (SAFE TO COMMIT)
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_CLUSTER=devnet
VITE_HELIUS_API_KEY=your-helius-api-key-here
VITE_PROVER_URL=http://localhost:8787
VITE_AIRDROP_AUTHORITY=55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax
VITE_SHIELD_PROGRAM=3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz
VITE_FEE_COLLECTOR_TOKEN_ACCOUNT=9m2X65ZUxX24imqkdxpTHabB3dqt7GkaJuz9H2Bg1T85
```

---

## SECURITY CHECKLIST FOR PUBLIC REPOS

### ✅ What's Safe to Expose
- Program IDs (public addresses)
- Token account addresses (PDAs)
- Mint addresses
- Public keys (Solana addresses)
- RPC endpoints (already public)
- Deployed contract addresses
- Network IDs

### ❌ What Must NEVER Be Exposed
- Private keys / secret keys
- Mnemonic seed phrases
- API keys / auth tokens
- Database passwords
- Secret environment variables
- Firebase keys
- AWS credentials
- Any authentication tokens

### 🟡 What Requires Care
- Airdrop authority wallets (public key OK, private key CRITICAL)
- Admin addresses (if they have special privileges)
- Fee collector addresses (public OK, but document why)

---

## Current Status Scan Results

### Files Checked
```
✅ Programs (Rust)        - No secrets found
✅ ZK circuits (Circom)   - No secrets found
✅ TypeScript code        - No hardcoded secrets in logic
⚠️ app/.env               - EXPOSED (Helius API key)
✅ app/.env.staging       - Has placeholder (SAFE)
✅ app/.env.example       - Template only (SAFE)
✅ Documentation          - No secrets
✅ Config files           - No secrets
```

---

## Audit Results

| File | Issue | Severity | Action |
|------|-------|----------|--------|
| `app/.env` | Helius API key exposed | 🔴 CRITICAL | Rotate immediately |
| `app/.env` | Hardcoded env vars | 🟡 MEDIUM | Remove from git |
| `app/.gitignore` | Missing .env rule | 🟡 MEDIUM | Add pattern |
| `Anchor.toml` | Program ID exposed | ✅ OK | Public testnet |
| `README.md` | Airdrop addr exposed | ✅ OK | Public testnet |

---

## Prevention for Future

### Setup `.gitignore` Properly

```bash
# .gitignore entry
*.env
*.env.local
*.env.*.local
.env.production*
.env.development*

# But DO commit:
!.env.example
!.env.template
```

### Use Environment-based Configuration

```typescript
// ✅ GOOD: Use environment variables
const apiKey = process.env.VITE_HELIUS_API_KEY;

// ❌ BAD: Hardcode secrets
const apiKey = "5d57d00d-0ea2-4fe1-8d81-bc8b4aed3f18";
```

### Pre-commit Hook

```bash
# .git/hooks/pre-commit
#!/bin/bash
if git diff --cached | grep -E "(PRIVATE_KEY|SECRET|API_KEY)"; then
  echo "ERROR: Detected potential secret in staged files!"
  exit 1
fi
```

---

## Recommendations

### Immediate (Next Hour)
1. ✅ Rotate Helius API key
2. ✅ Create `.env` rule in `.gitignore`
3. ✅ Remove `.env` from git if committed

### Short-term (This Week)
1. ✅ Audit entire codebase for hardcoded secrets
2. ✅ Set up environment-based config
3. ✅ Document secrets in README (setup guide)
4. ✅ Use GitHub Secrets for CI/CD

### Long-term (Before Mainnet)
1. ✅ Implement vault system (e.g., HashiCorp Vault)
2. ✅ Set up secret scanning (GitHub Advanced Security)
3. ✅ Regular security audits
4. ✅ Automated secret detection in CI/CD

---

## For Testnet (Current Status)

**Impact Level**: LOW-MEDIUM (testnet only)
- No real funds at risk
- Helius key could be abused for rate limiting
- No production data compromised
- Can be fixed without emergency measures

**Action**: Fix before moving to mainnet

---

## Commit Instructions

```bash
# After fixing:
git add app/.gitignore app/.env.example
git rm --cached app/.env  # If it was tracked
git commit -m "security: protect secrets and add proper .gitignore rules"
git push origin main
```

---

## ✅ Completion Checklist

- [ ] Helius API key rotated
- [ ] New key added to `.env` (local only)
- [ ] `.env` added to `.gitignore`
- [ ] `app/.env` removed from git tracking
- [ ] Analysis files committed
- [ ] GitHub secrets configured (if needed)
- [ ] Documentation updated
- [ ] Team notified of changes

---

**NEXT**: Fix these issues, then commit the analysis documents.

