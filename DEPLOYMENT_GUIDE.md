# GitHub Actions Deployment Setup

## Prerequisites

You need to add GitHub Secrets for the SSH key and known hosts.

## Step 1: Get Your SSH Key Content

**In Git Bash:**

```bash
cd c:/Users/NEXTGEN\ VC/Desktop/DeVOPS/cuet-micro-ops-hackthon-2025
cat shawKey.pem
```

Copy the entire output (including `-----BEGIN RSA PRIVATE KEY-----` and `-----END RSA PRIVATE KEY-----`)

## Step 2: Get Known Hosts

**In Git Bash:**

```bash
ssh-keyscan -t rsa 10.10.0.8 >> ~/.ssh/known_hosts 2>&1
cat ~/.ssh/known_hosts | grep 10.10.0.8
```

Copy that line

## Step 3: Add GitHub Secrets

1. Go to your GitHub repository: `https://github.com/Raihan-Naieem/cuet-micro-ops-hackthon-2025`
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**

### Add Secret 1: VM_SSH_KEY

- **Name:** `VM_SSH_KEY`
- **Value:** Paste the entire content from Step 1 (the .pem file)
- Click **Add secret**

### Add Secret 2: VM_KNOWN_HOSTS

- **Name:** `VM_KNOWN_HOSTS`
- **Value:** Paste the line from Step 2
- Click **Add secret**

## Step 4: Trigger Deployment

**Option A: Push to main branch**

```bash
git checkout main
git merge test-ci-workflow
git push origin main
```

**Option B: Manual trigger**

1. Go to **Actions** tab
2. Click **Deploy to VM** workflow
3. Click **Run workflow** → **main branch**

## Step 5: Monitor Deployment

1. Go to **Actions** tab
2. Click the running workflow
3. Watch the logs in real-time
4. Check if deployment succeeded

## Troubleshooting

**SSH Connection refused:**

- Make sure the VM is running
- Verify the IP address (10.10.0.8)
- Check VM firewall allows port 22

**Git pull fails:**

- Verify repo URL is correct
- Check branch exists (main)
- Ensure you're pulling from origin

**Docker services don't start:**

- Check Docker is installed on VM
- Verify docker-compose.prod.yml exists
- Check logs: `docker compose -f docker/compose.prod.yml logs`

**Health check fails:**

- Wait a few seconds for app to start
- Check port 3000 is accessible
- View app logs on VM
