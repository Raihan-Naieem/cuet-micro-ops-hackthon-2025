# VM Setup Script for Delineate on Brilliant Cloud
# Run in PowerShell with: .\setup-vm.ps1

$VM_IP = "10.10.0.8"
$KEY_FILE = "c:\Users\NEXTGEN VC\Desktop\DeVOPS\cuet-micro-ops-hackthon-2025\shawKey.pem"
$USERNAME = "ubuntu"

Write-Host "🚀 Starting VM Setup for $VM_IP..." -ForegroundColor Green

# Step 1: Fix SSH key permissions
Write-Host "`n📝 Step 1: Fixing SSH key permissions..." -ForegroundColor Cyan
icacls $KEY_FILE /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null
Write-Host "✅ SSH key permissions fixed" -ForegroundColor Green

# Step 2: Test SSH connection
Write-Host "`n🔌 Step 2: Testing SSH connection..." -ForegroundColor Cyan
ssh -i $KEY_FILE $USERNAME@$VM_IP "echo 'SSH connection successful!'"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ SSH connection failed! Check your IP and key." -ForegroundColor Red
    exit 1
}
Write-Host "✅ SSH connection successful" -ForegroundColor Green

# Step 3: Run setup on VM
Write-Host "`n⚙️  Step 3: Running setup commands on VM..." -ForegroundColor Cyan

$SETUP_COMMANDS = @"
set -e

echo "📦 Updating system..."
sudo apt-get update && sudo apt-get upgrade -y

echo "📦 Installing Node.js 24..."
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git curl

echo "📦 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker ubuntu

echo "📂 Cloning repository..."
cd /home/ubuntu
git clone https://github.com/Raihan-Naieem/cuet-micro-ops-hackthon-2025.git app
cd app

echo "📦 Installing npm dependencies..."
npm install

echo "⚙️  Creating .env file..."
cp .env.example .env

echo "🐳 Starting Docker Compose (MinIO + App)..."
docker compose -f docker/compose.prod.yml up -d

echo "⏳ Waiting for services to start..."
sleep 10

echo "📊 Checking status..."
docker compose -f docker/compose.prod.yml ps

echo ""
echo "================================"
echo "✅ VM Setup Complete!"
echo "================================"
echo "🌐 App URL: http://$VM_IP:3000"
echo "🪣 MinIO URL: http://$VM_IP:9000"
echo "MinIO Credentials: minioadmin / minioadmin"
echo ""
"@

ssh -i $KEY_FILE $USERNAME@$VM_IP $SETUP_COMMANDS

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Setup completed successfully!" -ForegroundColor Green
    Write-Host "`n📋 Next steps:" -ForegroundColor Yellow
    Write-Host "1. Open browser: http://$VM_IP:3000"
    Write-Host "2. Test health endpoint: curl http://$VM_IP:3000/health"
    Write-Host "3. Access MinIO: http://$VM_IP:9000 (minioadmin/minioadmin)"
} else {
    Write-Host "`n❌ Setup failed! Check the errors above." -ForegroundColor Red
    exit 1
}
