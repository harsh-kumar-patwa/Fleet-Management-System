#!/bin/bash
# =====================================================================
# Cloud Computing - Assignment 2 : one-shot setup for AWS CloudShell
#
#   EMAIL=you@example.com bash setup.sh
#
# Builds:  S1 Elastic Beanstalk (PaaS-Web-App)   S2 Web-Server-1/2 + Web-Target-Group + App-ALB
#          S3 Database-VPC + App-Database (RDS MySQL) + App-DB-Peering + routes
#          S4 SNS Server-Alerts + CloudWatch High-CPU alarm
# Safe to re-run: existing resources are found by name and reused.
# State is saved to ~/a2-state.env (used by cleanup.sh).
# =====================================================================
set -euo pipefail

EMAIL="${EMAIL:?Run as: EMAIL=you@example.com bash setup.sh}"
REGION="${REGION:-${AWS_REGION:-us-east-1}}"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.micro}"      # free-tier eligible (use t2.micro on older accounts if t3 is rejected)
DB_CLASS="${DB_CLASS:-db.t3.micro}"             # free-tier eligible
DB_USER="admin"
DB_PASS="${DB_PASS:-A2-$(openssl rand -hex 6)}"
export AWS_DEFAULT_REGION="$REGION" AWS_PAGER=""
AZ1="${REGION}a"; AZ2="${REGION}b"
STATE=~/a2-state.env
[ -f "$STATE" ] && source "$STATE"
save(){ grep -v "^$1=" "$STATE" 2>/dev/null > "$STATE.tmp" || true; echo "$1='$2'" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; eval "$1='$2'"; }
save DB_PASS "${DB_PASS}"; save REGION "$REGION"
log(){ echo -e "\n\033[1;36m==> $*\033[0m"; }
name(){ aws ec2 create-tags --resources "$1" --tags "Key=Name,Value=$2"; }
none(){ [ -z "$1" ] || [ "$1" = "None" ] || [ "$1" = "null" ]; }

# ---------------------------------------------------------------------
log "Web VPC: Cloud-Assignment-VPC (10.0.0.0/16)"
WEB_VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=Cloud-Assignment-VPC --query 'Vpcs[0].VpcId' --output text)
if none "$WEB_VPC"; then
  echo "Not found - creating it."
  WEB_VPC=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query Vpc.VpcId --output text); name "$WEB_VPC" Cloud-Assignment-VPC
  aws ec2 modify-vpc-attribute --vpc-id "$WEB_VPC" --enable-dns-hostnames
  IGW=$(aws ec2 create-internet-gateway --query InternetGateway.InternetGatewayId --output text); name "$IGW" Cloud-Assignment-IGW
  aws ec2 attach-internet-gateway --vpc-id "$WEB_VPC" --internet-gateway-id "$IGW"
  PUB1=$(aws ec2 create-subnet --vpc-id "$WEB_VPC" --cidr-block 10.0.1.0/24 --availability-zone "$AZ1" --query Subnet.SubnetId --output text); name "$PUB1" Public-Subnet-1
  PUB2=$(aws ec2 create-subnet --vpc-id "$WEB_VPC" --cidr-block 10.0.2.0/24 --availability-zone "$AZ2" --query Subnet.SubnetId --output text); name "$PUB2" Public-Subnet-2
  for s in $PUB1 $PUB2; do aws ec2 modify-subnet-attribute --subnet-id "$s" --map-public-ip-on-launch; done
  WEB_RT=$(aws ec2 create-route-table --vpc-id "$WEB_VPC" --query RouteTable.RouteTableId --output text); name "$WEB_RT" Public-Route-Table
  aws ec2 create-route --route-table-id "$WEB_RT" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW" >/dev/null
  for s in $PUB1 $PUB2; do aws ec2 associate-route-table --route-table-id "$WEB_RT" --subnet-id "$s" >/dev/null; done
  save CREATED_WEB_VPC yes; save IGW "$IGW"
else
  echo "Found existing $WEB_VPC - looking for public subnets in $AZ1 / $AZ2."
  PUB1=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$WEB_VPC" Name=availability-zone,Values="$AZ1" Name=map-public-ip-on-launch,Values=true --query 'Subnets[0].SubnetId' --output text)
  PUB2=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$WEB_VPC" Name=availability-zone,Values="$AZ2" Name=map-public-ip-on-launch,Values=true --query 'Subnets[0].SubnetId' --output text)
  if none "$PUB1" || none "$PUB2"; then echo "ERROR: need a public subnet (auto-assign public IP = on) in both $AZ1 and $AZ2 of Cloud-Assignment-VPC."; exit 1; fi
  WEB_RT=$(aws ec2 describe-route-tables --filters Name=association.subnet-id,Values="$PUB1" --query 'RouteTables[0].RouteTableId' --output text)
  none "$WEB_RT" && WEB_RT=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values="$WEB_VPC" Name=association.main,Values=true --query 'RouteTables[0].RouteTableId' --output text)
fi
save WEB_VPC "$WEB_VPC"; save PUB1 "$PUB1"; save PUB2 "$PUB2"; save WEB_RT "$WEB_RT"

sg(){ # sg <name> <desc> <vpc>
  local id; id=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$1" Name=vpc-id,Values="$3" --query 'SecurityGroups[0].GroupId' --output text)
  if none "$id"; then id=$(aws ec2 create-security-group --group-name "$1" --description "$2" --vpc-id "$3" --query GroupId --output text); name "$id" "$1"; fi
  echo "$id"; }
ingress(){ aws ec2 authorize-security-group-ingress "$@" >/dev/null 2>&1 || true; }

# ---------------------------------------------------------------------
log "Section 1: IAM roles for Elastic Beanstalk"
cat > /tmp/ec2-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
cat > /tmp/eb-trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"elasticbeanstalk.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
aws iam get-role --role-name aws-elasticbeanstalk-ec2-role >/dev/null 2>&1 || {
  aws iam create-role --role-name aws-elasticbeanstalk-ec2-role --assume-role-policy-document file:///tmp/ec2-trust.json >/dev/null
  aws iam attach-role-policy --role-name aws-elasticbeanstalk-ec2-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkWebTier; }
aws iam get-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role >/dev/null 2>&1 || {
  aws iam create-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role >/dev/null
  aws iam add-role-to-instance-profile --instance-profile-name aws-elasticbeanstalk-ec2-role --role-name aws-elasticbeanstalk-ec2-role
  echo "waiting for instance profile to propagate..."; sleep 15; }
aws iam get-role --role-name aws-elasticbeanstalk-service-role >/dev/null 2>&1 || {
  aws iam create-role --role-name aws-elasticbeanstalk-service-role --assume-role-policy-document file:///tmp/eb-trust.json >/dev/null
  aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSElasticBeanstalkEnhancedHealth
  aws iam attach-role-policy --role-name aws-elasticbeanstalk-service-role --policy-arn arn:aws:iam::aws:policy/AWSElasticBeanstalkManagedUpdatesCustomerRolePolicy; }

log "Section 1: Elastic Beanstalk application PaaS-Web-App (Node.js sample, load balanced)"
aws elasticbeanstalk describe-applications --application-names PaaS-Web-App --query 'Applications[0].ApplicationName' --output text | grep -q PaaS-Web-App \
  || aws elasticbeanstalk create-application --application-name PaaS-Web-App --description "Assignment 2 PaaS demo" >/dev/null
ENV_STATUS=$(aws elasticbeanstalk describe-environments --application-name PaaS-Web-App --environment-names PaaS-Web-App-env --no-include-deleted --query 'Environments[0].Status' --output text)
if none "$ENV_STATUS" || [ "$ENV_STATUS" = "Terminated" ]; then
  STACK=$(aws elasticbeanstalk list-available-solution-stacks --query "SolutionStacks[?contains(@,'Amazon Linux 2023') && contains(@,'Node.js')] | [0]" --output text)
  echo "Platform: $STACK"
  aws elasticbeanstalk create-environment --application-name PaaS-Web-App --environment-name PaaS-Web-App-env \
    --cname-prefix "paas-web-app-$(openssl rand -hex 3)" --solution-stack-name "$STACK" --option-settings \
    Namespace=aws:elasticbeanstalk:environment,OptionName=EnvironmentType,Value=LoadBalanced \
    Namespace=aws:elasticbeanstalk:environment,OptionName=LoadBalancerType,Value=application \
    Namespace=aws:elasticbeanstalk:environment,OptionName=ServiceRole,Value=aws-elasticbeanstalk-service-role \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=IamInstanceProfile,Value=aws-elasticbeanstalk-ec2-role \
    Namespace=aws:ec2:instances,OptionName=InstanceTypes,Value="$INSTANCE_TYPE" \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=2 \
    Namespace=aws:ec2:vpc,OptionName=VPCId,Value="$WEB_VPC" \
    "Namespace=aws:ec2:vpc,OptionName=Subnets,Value=$PUB1,$PUB2" \
    "Namespace=aws:ec2:vpc,OptionName=ELBSubnets,Value=$PUB1,$PUB2" \
    Namespace=aws:ec2:vpc,OptionName=AssociatePublicIpAddress,Value=true >/dev/null
  echo "Beanstalk environment creation started (takes ~5-8 min, continuing in parallel)."
fi

# ---------------------------------------------------------------------
log "Section 3: Database-VPC (10.1.0.0/16) with two private subnets"
DB_VPC=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=Database-VPC --query 'Vpcs[0].VpcId' --output text)
if none "$DB_VPC"; then
  DB_VPC=$(aws ec2 create-vpc --cidr-block 10.1.0.0/16 --query Vpc.VpcId --output text); name "$DB_VPC" Database-VPC
  aws ec2 modify-vpc-attribute --vpc-id "$DB_VPC" --enable-dns-hostnames
  PRIV1=$(aws ec2 create-subnet --vpc-id "$DB_VPC" --cidr-block 10.1.1.0/24 --availability-zone "$AZ1" --query Subnet.SubnetId --output text); name "$PRIV1" DB-Private-Subnet-1
  PRIV2=$(aws ec2 create-subnet --vpc-id "$DB_VPC" --cidr-block 10.1.2.0/24 --availability-zone "$AZ2" --query Subnet.SubnetId --output text); name "$PRIV2" DB-Private-Subnet-2
  DB_RT=$(aws ec2 create-route-table --vpc-id "$DB_VPC" --query RouteTable.RouteTableId --output text); name "$DB_RT" Database-Private-RT
  for s in $PRIV1 $PRIV2; do aws ec2 associate-route-table --route-table-id "$DB_RT" --subnet-id "$s" >/dev/null; done
else
  PRIV1=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$DB_VPC" Name=cidr-block,Values=10.1.1.0/24 --query 'Subnets[0].SubnetId' --output text)
  PRIV2=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$DB_VPC" Name=cidr-block,Values=10.1.2.0/24 --query 'Subnets[0].SubnetId' --output text)
  DB_RT=$(aws ec2 describe-route-tables --filters Name=tag:Name,Values=Database-Private-RT --query 'RouteTables[0].RouteTableId' --output text)
fi
save DB_VPC "$DB_VPC"; save PRIV1 "$PRIV1"; save PRIV2 "$PRIV2"; save DB_RT "$DB_RT"

log "Section 3: RDS security group (MySQL 3306 from 10.0.0.0/16) and subnet group"
DB_SG=$(sg DB-SG "MySQL from Web VPC" "$DB_VPC"); save DB_SG "$DB_SG"
ingress --group-id "$DB_SG" --protocol tcp --port 3306 --cidr 10.0.0.0/16
aws rds describe-db-subnet-groups --db-subnet-group-name app-db-subnet-group >/dev/null 2>&1 || \
  aws rds create-db-subnet-group --db-subnet-group-name app-db-subnet-group --db-subnet-group-description "Database-VPC private subnets" --subnet-ids "$PRIV1" "$PRIV2" >/dev/null

log "Section 3: RDS MySQL App-Database (private, free tier) - takes ~10 min"
if ! aws rds describe-db-instances --db-instance-identifier app-database >/dev/null 2>&1; then
  aws rds create-db-instance --db-instance-identifier App-Database --engine mysql --db-instance-class "$DB_CLASS" \
    --allocated-storage 20 --storage-type gp2 --master-username "$DB_USER" --master-user-password "$DB_PASS" \
    --db-subnet-group-name app-db-subnet-group --vpc-security-group-ids "$DB_SG" --no-publicly-accessible \
    --no-multi-az --backup-retention-period 0 --db-name appdb >/dev/null
  echo "RDS creation started (continuing in parallel)."
fi

# ---------------------------------------------------------------------
log "Section 2: security groups"
ALB_SG=$(sg ALB-SG "HTTP from internet" "$WEB_VPC"); save ALB_SG "$ALB_SG"
ingress --group-id "$ALB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0
WEB_SG=$(sg Web-SG "Web servers" "$WEB_VPC"); save WEB_SG "$WEB_SG"
ingress --group-id "$WEB_SG" --protocol tcp --port 80 --source-group "$ALB_SG"
ingress --group-id "$WEB_SG" --protocol tcp --port 80 --cidr 0.0.0.0/0
EIC_PL=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values="com.amazonaws.$REGION.ec2-instance-connect" --query 'PrefixLists[0].PrefixListId' --output text)
if none "$EIC_PL"; then ingress --group-id "$WEB_SG" --protocol tcp --port 22 --cidr 0.0.0.0/0
else ingress --group-id "$WEB_SG" --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,PrefixListIds=[{PrefixListId=$EIC_PL}]"; fi

log "Section 2: EC2 Web-Server-1 ($AZ1) and Web-Server-2 ($AZ2)"
AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)
launch(){ # launch <n> <subnet>
  local id; id=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=Web-Server-$1" Name=instance-state-name,Values=pending,running --query 'Reservations[0].Instances[0].InstanceId' --output text)
  if none "$id"; then
    cat > /tmp/ud$1.sh <<EOF
#!/bin/bash
dnf install -y httpd nmap-ncat mariadb105
TOKEN=\$(curl -s -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60")
AZ=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)
IP=\$(curl -s -H "X-aws-ec2-metadata-token: \$TOKEN" http://169.254.169.254/latest/meta-data/local-ipv4)
cat > /var/www/html/index.html <<HTML
<!doctype html><html><head><title>Server $1</title></head>
<body style="font-family:sans-serif;text-align:center;margin-top:15vh;background:$( [ "$1" = 1 ] && echo '#dbeafe' || echo '#dcfce7')">
<h1 style="font-size:64px">Server $1</h1><p>Web-Server-$1 &middot; AZ: \$AZ &middot; Private IP: \$IP</p></body></html>
HTML
systemctl enable --now httpd
EOF
    id=$(aws ec2 run-instances --image-id "$AMI" --instance-type "$INSTANCE_TYPE" --subnet-id "$2" --security-group-ids "$WEB_SG" \
      --associate-public-ip-address --user-data file:///tmp/ud$1.sh --metadata-options HttpTokens=required \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=Web-Server-$1}]" --query 'Instances[0].InstanceId' --output text)
  fi
  echo "$id"; }
WS1=$(launch 1 "$PUB1"); WS2=$(launch 2 "$PUB2"); save WS1 "$WS1"; save WS2 "$WS2"
echo "Web-Server-1=$WS1  Web-Server-2=$WS2"; aws ec2 wait instance-running --instance-ids "$WS1" "$WS2"

log "Section 2: Target group Web-Target-Group (HTTP:80, health check /)"
TG=$(aws elbv2 describe-target-groups --names Web-Target-Group --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
none "$TG" && TG=$(aws elbv2 create-target-group --name Web-Target-Group --protocol HTTP --port 80 --vpc-id "$WEB_VPC" --target-type instance \
  --health-check-protocol HTTP --health-check-path / --health-check-interval-seconds 10 --healthy-threshold-count 2 --query 'TargetGroups[0].TargetGroupArn' --output text)
save TG "$TG"
aws elbv2 register-targets --target-group-arn "$TG" --targets Id="$WS1" Id="$WS2"

log "Section 2: Application Load Balancer App-ALB + listener :80"
ALB=$(aws elbv2 describe-load-balancers --names App-ALB --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
none "$ALB" && ALB=$(aws elbv2 create-load-balancer --name App-ALB --type application --scheme internet-facing --subnets "$PUB1" "$PUB2" --security-groups "$ALB_SG" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
save ALB "$ALB"
aws elbv2 describe-listeners --load-balancer-arn "$ALB" --query 'Listeners[?Port==`80`]' --output text | grep -q . || \
  aws elbv2 create-listener --load-balancer-arn "$ALB" --protocol HTTP --port 80 --default-actions Type=forward,TargetGroupArn="$TG" >/dev/null
ALB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName' --output text); save ALB_DNS "$ALB_DNS"

# ---------------------------------------------------------------------
log "Section 3: VPC peering App-DB-Peering + routes"
PCX=$(aws ec2 describe-vpc-peering-connections --filters Name=tag:Name,Values=App-DB-Peering Name=status-code,Values=active,pending-acceptance --query 'VpcPeeringConnections[0].VpcPeeringConnectionId' --output text)
if none "$PCX"; then
  PCX=$(aws ec2 create-vpc-peering-connection --vpc-id "$WEB_VPC" --peer-vpc-id "$DB_VPC" --query VpcPeeringConnection.VpcPeeringConnectionId --output text)
  name "$PCX" App-DB-Peering
  aws ec2 wait vpc-peering-connection-exists --vpc-peering-connection-ids "$PCX"
fi
aws ec2 accept-vpc-peering-connection --vpc-peering-connection-id "$PCX" >/dev/null 2>&1 || true
save PCX "$PCX"
aws ec2 create-route --route-table-id "$WEB_RT" --destination-cidr-block 10.1.0.0/16 --vpc-peering-connection-id "$PCX" >/dev/null 2>&1 || true
aws ec2 create-route --route-table-id "$DB_RT"  --destination-cidr-block 10.0.0.0/16 --vpc-peering-connection-id "$PCX" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------
log "Section 4: SNS topic Server-Alerts + email subscription ($EMAIL)"
TOPIC=$(aws sns create-topic --name Server-Alerts --query TopicArn --output text); save TOPIC "$TOPIC"
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC" --query "Subscriptions[?Endpoint=='$EMAIL']" --output text | grep -q . || \
  aws sns subscribe --topic-arn "$TOPIC" --protocol email --notification-endpoint "$EMAIL" >/dev/null
echo ">>> Check $EMAIL now and click 'Confirm subscription'."

log "Section 4: CloudWatch alarm High-CPU-Web-Server-1 (CPU > 70%)"
aws cloudwatch put-metric-alarm --alarm-name High-CPU-Web-Server-1 --alarm-description "CPU > 70% on Web-Server-1" \
  --namespace AWS/EC2 --metric-name CPUUtilization --dimensions Name=InstanceId,Value="$WS1" \
  --statistic Average --period 300 --evaluation-periods 1 --threshold 70 --comparison-operator GreaterThanThreshold \
  --alarm-actions "$TOPIC" --ok-actions "$TOPIC" --treat-missing-data notBreaching

# ---------------------------------------------------------------------
log "Waiting for targets to become healthy"
for i in $(seq 1 30); do
  H=$(aws elbv2 describe-target-health --target-group-arn "$TG" --query "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])" --output text)
  echo "healthy targets: $H/2"; [ "$H" = "2" ] && break; sleep 10; done
echo "ALB responses:"; for i in 1 2 3 4 5 6; do curl -s "http://$ALB_DNS/" | grep -o 'Server [12]' | head -1; done || true

log "Waiting for RDS App-Database to become available (can take 10+ min)"
aws rds wait db-instance-available --db-instance-identifier app-database
DB_HOST=$(aws rds describe-db-instances --db-instance-identifier app-database --query 'DBInstances[0].Endpoint.Address' --output text); save DB_HOST "$DB_HOST"

log "Waiting for Elastic Beanstalk environment"
aws elasticbeanstalk wait environment-updated --application-name PaaS-Web-App --environment-names PaaS-Web-App-env || true
EB_URL=$(aws elasticbeanstalk describe-environments --application-name PaaS-Web-App --environment-names PaaS-Web-App-env --query 'Environments[0].CNAME' --output text); save EB_URL "$EB_URL"
EB_HEALTH=$(aws elasticbeanstalk describe-environments --application-name PaaS-Web-App --environment-names PaaS-Web-App-env --query 'Environments[0].[Status,Health]' --output text)

cat <<EOF

=====================================================================
 DONE  (values saved in $STATE)
=====================================================================
 S1  Beanstalk URL : http://$EB_URL      [$EB_HEALTH]
 S2  ALB DNS       : http://$ALB_DNS
 S3  RDS endpoint  : $DB_HOST
     DB user/pass  : $DB_USER / $DB_PASS
     Peering       : $PCX
 S4  SNS topic     : $TOPIC   (confirm the email!)

 DB connectivity test - EC2 console > Web-Server-1 > Connect > EC2 Instance Connect > Connect, then run:
   nc -zv $DB_HOST 3306
   mysql -h $DB_HOST -u $DB_USER -p'$DB_PASS' -e "SELECT VERSION(), @@hostname, NOW();"

 When finished with screenshots:  bash cleanup.sh
=====================================================================
EOF
