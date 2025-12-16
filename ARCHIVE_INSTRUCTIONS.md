# Making Repository Read-Only (Archive Mode)

## How to Archive the Repository on GitHub

When you're ready to make this repository public and read-only:

### Steps to Archive on GitHub:

1. **Go to Repository Settings**
   - Navigate to https://github.com/NOC-tura/Noctura-Test-Wallet-App/settings

2. **Scroll to Danger Zone**
   - At the bottom of the Settings page, find the "Danger Zone" section

3. **Archive Repository**
   - Click "Archive this repository"
   - Type the repository name to confirm
   - Click "I understand the consequences, archive this repository"

### What Archiving Does:

✅ Makes repository **read-only**  
✅ Prevents all modifications (commits, issues, PRs)  
✅ Allows cloning and forking  
✅ Maintains all code and history  
✅ Shows "archived" badge on repository  
✅ Still searchable and discoverable  

### Before Making Public:

Run this security checklist:

```bash
# 1. Verify no .env files were committed
git ls-files | grep '\.env$'
# Should return nothing (only .env.example files should exist)

# 2. Check for exposed secrets
git log --all --full-history --source -- '*.env'
git log --all --full-history --source -- '*id.json'
# Should return nothing

# 3. Verify .gitignore is working
git check-ignore .env app/.env zk/prover-service/.env
# Should show all three paths are ignored

# 4. Search for API keys in committed files
git grep -i "5d57d00d-0ea2-4fe1-8d81"
# Should only show SECURITY.md and examples (not actual keys)
```

## Alternative: Branch Protection (Without Archiving)

If you want to keep the repo active but enforce read-only for most users:

1. **Settings → Branches → Add rule**
2. **Branch name pattern:** `main`
3. **Check these options:**
   - ✅ Require pull request reviews before merging
   - ✅ Require status checks to pass
   - ✅ Do not allow bypassing the above settings
   - ✅ Restrict who can push to matching branches (select only admins)

## Making Repository Public

1. **Go to Settings → General**
2. **Scroll to "Danger Zone"**
3. **Click "Change repository visibility"**
4. **Select "Make public"**
5. **Type repository name to confirm**
6. **Click "I understand, make this repository public"**

## Post-Publication Checklist

After making public, verify:

- [ ] README.md shows placeholder API keys only
- [ ] No .env files in repository
- [ ] No private keypairs committed
- [ ] SECURITY.md is visible
- [ ] "Archived" badge appears (if archived)
- [ ] Clone works: `git clone https://github.com/NOC-tura/Noctura-Test-Wallet-App.git`
- [ ] Users can fork but not push

## Unarchiving (If Needed)

To reverse archiving later:
1. Settings → Danger Zone
2. "Unarchive this repository"
3. Confirm

---

## Current Security Status

✅ **Private keys:** None committed (protected by .gitignore)  
✅ **API keys:** Removed from all committed files  
✅ **Sensitive data:** .env files excluded from git  
✅ **Documentation:** SECURITY.md created  
✅ **History:** Clean (no secrets in git history)  

**Repository is safe to make public and archive.**
