# 🚀 Ready for Public Devnet Testing

The repository is sanitized and safe to expose publicly. Use this checklist to open devnet testing while setting expectations for missing features.

---

## ✅ What’s Done
- Git history scanned: no secrets committed
- `.env` files ignored; only `.env.example` tracked
- Security docs published (`SECURITY_AUDIT_REPORT.md`, `SECURITY_STATUS.md`)
- Core flows validated: deposit → shielded transfer → withdraw on devnet

---

## 🧭 Testing Scope & Known Gaps
- Missing UI: commitment explorer, Merkle root sync display, view-key manager
- Prover infra: single worker, no queue/GPU/cache; heavy load may slow proofs
- Expectation for testers: record tx signatures for failing flows; proofs generated off-chain via prover service

---

## 🔑 Pre-Launch Checklist (Devnet)
- [ ] Rotate fresh **devnet** Helius API key; place it only in local `.env`
- [ ] Update local `.env` from `.env.example`; do **not** commit
- [ ] Set `VITE_PROVER_URL` to the prover endpoint you expose to testers
- [ ] Confirm fee collector ATA and program IDs for the current deploy
- [ ] Run smoke tests: deposit → transfer → withdraw (SOL + NOC) and capture tx sigs
- [ ] Enable basic rate limiting on prover endpoints to prevent abuse

---

## 🌐 Make the Repo Public
1) Go to GitHub repo settings → **Danger Zone** → **Change repository visibility** → **Make public**.  
2) Verify `.env` is untracked: `git status | grep .env` should return nothing.

Optional (for read-only snapshot): archive via **Settings → Archive this repository**.

---

## 🔍 Quick Verification Commands
```bash
# Confirm no secrets in history
git log --all -p | grep -i "HELIUS_API_KEY\|PRIVATE_KEY\|SECRET" | wc -l

# Confirm only templates are tracked
git ls-files | grep "\.env"  # should show .env.example files only
```

---

## 📄 Files to Know
- README.md – setup and usage
- SECURITY_STATUS.md – current security state (safe for public release)
- SECURITY_AUDIT_REPORT.md – findings and remediation
- ARCHIVE_INSTRUCTIONS.md – optional read-only archiving steps

---

**Status:** Ready for public devnet testing. Keep secrets local, call out known gaps to testers, and rate-limit the prover.
