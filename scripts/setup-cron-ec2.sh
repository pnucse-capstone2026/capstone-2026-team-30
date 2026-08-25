#!/bin/bash
# AWS EC2 기반 Cron 스케줄러 전용 인스턴스 자동 프로비저닝 스크립트
# 도입 배경: 매일 08:00 KST 멀티클러스터(Hub/Spoke) 및 ALB 셋업, 20:00 KST 전체 회수(과금 0원화)를 전담 수행하는 자동화 호스트 구축
set -e

REGION="${1:-us-east-1}"
ROLE_NAME="KyvernoCronEC2Role"
PROFILE_NAME="KyvernoCronEC2Profile"
SG_NAME="kyverno-cron-ec2-sg"
INSTANCE_TYPE="t3.small"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=========================================================="
echo " 🚀 Provisioning Dedicated Cron EC2 Instance"
echo ">>> Target Region  : ${REGION}"
echo ">>> Instance Type  : ${INSTANCE_TYPE}"
echo "=========================================================="

# 1. AWS IAM 자격 증명 확인
if ! aws sts get-caller-identity --region "${REGION}" &> /dev/null; then
  echo "[ERROR] AWS CLI authentication failed for region ${REGION}."
  exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text)
echo ">>> AWS Account ID : ${ACCOUNT_ID}"

# 2. IAM Role & Instance Profile 생성
echo ">>> 1. Creating/Ensuring IAM Role '${ROLE_NAME}'..."
if ! aws iam get-role --role-name "${ROLE_NAME}" &> /dev/null; then
  ASSUME_ROLE_POLICY=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Service": "ec2.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF
)
  aws iam create-role --role-name "${ROLE_NAME}" --assume-role-policy-document "${ASSUME_ROLE_POLICY}"
  aws iam attach-role-policy --role-name "${ROLE_NAME}" --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess"
  echo ">>> Attached AdministratorAccess policy to ${ROLE_NAME}"
fi

if ! aws iam get-instance-profile --instance-profile-name "${PROFILE_NAME}" &> /dev/null; then
  aws iam create-instance-profile --instance-profile-name "${PROFILE_NAME}"
  aws iam add-role-to-instance-profile --instance-profile-name "${PROFILE_NAME}" --role-name "${ROLE_NAME}"
  echo ">>> Created Instance Profile '${PROFILE_NAME}' and bound to Role."
  sleep 10 # IAM 전파 대기
fi

# 3. 기본 VPC 및 Security Group 생성
VPC_ID=$(aws ec2 describe-vpcs --region "${REGION}" --filters "Name=is-default,Values=true" --query "Vpcs[0].VpcId" --output text)
if [ -z "${VPC_ID}" ] || [ "${VPC_ID}" = "None" ]; then
  VPC_ID=$(aws ec2 describe-vpcs --region "${REGION}" --query "Vpcs[0].VpcId" --output text)
fi

SG_ID=$(aws ec2 describe-security-groups --region "${REGION}" --filters "Name=group-name,Values=${SG_NAME}" "Name=vpc-id,Values=${VPC_ID}" --query "SecurityGroups[0].GroupId" --output text 2>/dev/null || true)

if [ -z "${SG_ID}" ] || [ "${SG_ID}" = "None" ]; then
  echo ">>> Creating Security Group '${SG_NAME}' in VPC ${VPC_ID}..."
  SG_ID=$(aws ec2 create-security-group --group-name "${SG_NAME}" --description "Kyverno Cron Scheduler EC2 Security Group" --vpc-id "${VPC_ID}" --region "${REGION}" --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --group-id "${SG_ID}" --protocol tcp --port 22 --cidr 0.0.0.0/0 --region "${REGION}"
fi

# 4. Amazon Linux 2023 최신 AMI ID 조회
AMI_ID=$(aws ssm get-parameters --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --region "${REGION}" --query "Parameters[0].Value" --output text)
echo ">>> Target AMI ID   : ${AMI_ID}"

# 5. UserData 클라우드 이니셜라이제이션 스크립트 작성
USER_DATA=$(cat <<'EOF'
#!/bin/bash
set -e
exec > >(tee /var/log/user-data.log|logger -t user-data -s /dev/console) 2>&1

echo "========================================="
echo " Setting up Kyverno Cron EC2 Environment"
echo "========================================="

# 기본 패키지 업데이트
dnf update -y
dnf install -y git curl tar jq cronie

systemctl enable crond
systemctl start crond

# CLI 도구 설치 (kubectl, eksctl, helm)
KUBECTL_VERSION="v1.35.0"
curl -Lo /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl"
chmod +x /usr/local/bin/kubectl

curl --silent --location "https://github.com/eksctl-io/eksctl/releases/latest/download/eksctl_Linux_amd64.tar.gz" | tar xz -C /usr/local/bin
chmod +x /usr/local/bin/eksctl

curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# 프로젝트 레포지토리 클론
cd /root
git clone https://github.com/YeongrimGo/PaC-KyvernoDashboard.git kyverno-dashboard
cd kyverno-dashboard
chmod +x scripts/*.sh

# Crontab 스케줄러 등록 (TZ=Asia/Seoul)
cat << 'CRONEOF' > /etc/cron.d/kyverno-schedule
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
TZ=Asia/Seoul

# [매일 16:00 KST] 멀티클러스터(Hub/Spoke) 프로비저닝 및 ALB Ingress 기동 후 이메일 발송
0 16 * * * root cd /root/kyverno-dashboard && ./scripts/setup-multicluster-eks.sh kyverno-eks-hub kyverno-eks-spoke-01 us-east-1 us-east-1 >> /var/log/kyverno-cron-afternoon.log 2>&1 && ./scripts/alb-ingress-on.sh >> /var/log/kyverno-cron-afternoon.log 2>&1 && ./scripts/send-cron-email.sh "[16:00 Afternoon] EKS Multi-Cluster & ALB Setup Result" "/var/log/kyverno-cron-afternoon.log" "yeongrimgo1106@pusan.ac.kr" >> /var/log/kyverno-cron-afternoon.log 2>&1

# [매일 19:00 KST] ALB Ingress 해제 및 멀티클러스터 과금 0원화 (Teardown) 후 이메일 발송
0 19 * * * root cd /root/kyverno-dashboard && ./scripts/alb-ingress-off.sh >> /var/log/kyverno-cron-evening.log 2>&1 && ./scripts/cleanup-eks-cluster.sh kyverno-eks-hub us-east-1 >> /var/log/kyverno-cron-evening.log 2>&1 && ./scripts/cleanup-eks-cluster.sh kyverno-eks-spoke-01 us-east-1 >> /var/log/kyverno-cron-evening.log 2>&1 && ./scripts/send-cron-email.sh "[19:00 Evening] EKS Multi-Cluster Teardown Result" "/var/log/kyverno-cron-evening.log" "yeongrimgo1106@pusan.ac.kr" >> /var/log/kyverno-cron-evening.log 2>&1
CRONEOF

chmod 0644 /etc/cron.d/kyverno-schedule

echo "========================================="
echo " Kyverno Cron Setup Completed Successfully!"
echo "========================================="
EOF
)

# 6. EC2 인스턴스 기동
echo ">>> Launching EC2 Instance '${INSTANCE_TYPE}' in ${REGION}..."
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "${AMI_ID}" \
  --instance-type "${INSTANCE_TYPE}" \
  --iam-instance-profile Name="${PROFILE_NAME}" \
  --security-group-ids "${SG_ID}" \
  --user-data "${USER_DATA}" \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=kyverno-cron-scheduler-ec2},{Key=Project,Value=KyvernoGovernancePlatform}]" \
  --region "${REGION}" \
  --query "Instances[0].InstanceId" \
  --output text)

echo "=========================================================="
echo " 🎉 Dedicated Cron EC2 Instance Provisioned!"
echo ">>> Instance ID   : ${INSTANCE_ID}"
echo ">>> IAM Profile   : ${PROFILE_NAME}"
echo ">>> SecurityGroup : ${SG_ID}"
echo "----------------------------------------------------------"
echo "💡 매일 08:00 KST: 멀티클러스터(Hub/Spoke) 및 ALB Ingress 자동 기동"
echo "💡 매일 20:00 KST: ALB 해제 및 멀티클러스터 과금 0원화 (Teardown)"
echo "=========================================================="
